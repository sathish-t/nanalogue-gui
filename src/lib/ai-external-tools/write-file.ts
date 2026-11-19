// External tool: write_file
// Writes a text file into the sandboxed directory. Files this chat session
// wrote can be replaced; any other existing file raises FileExistsError with a
// suggested free file name.

import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { MAX_FILENAME_LENGTH } from "../ai-chat-constants";
import { hasControlChars } from "../control-characters";
import {
    assertExistingAncestorInside,
    assertInside,
    isDeniedPath,
    resolvePath,
    SandboxError,
    toForwardSlashes,
} from "../monty-sandbox-helpers";
import type { SandboxToolSignature } from "../sandbox-tool-arguments";

export const /** Python parameters of write_file(), matched to each call by bindSandboxToolCall. */ WRITE_FILE_SIGNATURE: SandboxToolSignature =
        { positional: ["file_path", "content"], required: 2, keywordOnly: [] };

/**
 * Real paths of files written by write_file, plot_histogram, and plot_series
 * in the current chat session. Only these files may be overwritten; the set is
 * cleared by ChatSession.reset() through resetSessionWrittenFiles.
 */
const sessionWrittenFiles = new Set<string>();

/**
 * Forgets which files the current chat session wrote, so they are protected
 * from overwriting again. Called by ChatSession.reset() when a new chat starts.
 */
export function resetSessionWrittenFiles(): void {
    sessionWrittenFiles.clear();
}

/** Number of numbered names tried when suggesting a free file name. */
const FREE_FILE_NAME_ATTEMPTS = 100;

/**
 * Splits a file name into stem, numeric suffix, and extension, keeping a
 * trailing .gz or .bgz with the extension before it ("calls.vcf.gz" has
 * extension ".vcf.gz"). "results_2.bed" has stem "results" and number "2".
 * Numbers longer than nine digits stay in the stem, so they are never
 * printed in exponent form.
 */
const NUMBERED_FILE_NAME_PATTERN =
    /^(.+?)(?:_(\d{1,9}))?((?:\.[^.]+)?\.b?gz|\.[^.]*)?$/i;

/**
 * Suggests a free file name in the same directory after a write collision.
 *
 * Inserts or increments a numeric suffix before the extension, so
 * "results.bed" becomes "results_2.bed" and "results_2.bed" becomes
 * "results_3.bed". The name is only free when checked; it is not reserved.
 *
 * @param filePath - The colliding path as the caller passed it.
 * @param resolvedPath - The colliding path resolved against allowedDir.
 * @returns The suggested path in the caller's form, or undefined if none is free.
 */
async function suggestFreeFileName(
    filePath: string,
    resolvedPath: string,
): Promise<string | undefined> {
    // Windows also separates folders with backslashes; elsewhere a backslash
    // is an ordinary file-name character.
    const callerPath = sep === "\\" ? toForwardSlashes(filePath) : filePath;
    const slash = callerPath.lastIndexOf("/");
    const dirPrefix = callerPath.slice(0, slash + 1);
    const match = NUMBERED_FILE_NAME_PATTERN.exec(callerPath.slice(slash + 1));
    if (!match) return undefined;
    const [, stem, existingNumber, extension = ""] = match;
    const firstNumber = existingNumber ? Number(existingNumber) + 1 : 2;
    for (let i = 0; i < FREE_FILE_NAME_ATTEMPTS; i++) {
        // Keep zero padding, so "run_007.tsv" becomes "run_008.tsv".
        const number = String(firstNumber + i).padStart(
            existingNumber?.length ?? 0,
            "0",
        );
        const candidate = `${stem}_${number}${extension}`;
        if (candidate.length > MAX_FILENAME_LENGTH) return undefined;
        try {
            // lstat so a dangling symlink also counts as taken.
            await lstat(join(dirname(resolvedPath), candidate));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                return dirPrefix + candidate;
            }
        }
    }
    return undefined;
}

/**
 * Builds the FileExistsError raised when a write collides with an existing file.
 *
 * Tells the model that only files written in this chat can be replaced and
 * that files cannot be deleted, then suggests a free name.
 *
 * @param toolName - The Python tool that attempted the write, e.g. "write_file".
 * @param filePath - The colliding path as the caller passed it.
 * @param resolvedPath - The colliding path resolved against allowedDir.
 * @returns The SandboxError to throw.
 */
async function makeFileExistsError(
    toolName: string,
    filePath: string,
    resolvedPath: string,
): Promise<SandboxError> {
    const suggestion = await suggestFreeFileName(filePath, resolvedPath);
    const newNameAdvice = suggestion
        ? `Write to a new name instead, e.g. "${suggestion}" (currently free).`
        : "Write to a new name instead.";
    return new SandboxError(
        "FileExistsError",
        `${toolName}: "${filePath}" already exists and was not changed. ` +
            "Only files written earlier in this chat can be overwritten, " +
            `and files cannot be deleted. ${newNameAdvice}`,
    );
}

/**
 * Returns the write_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes that may be written in a single call.
 * @param toolName - Python tool named in the file-exists error; plotting tools pass their own name.
 * @returns An async function callable from Python that writes a file.
 */
export function makeWriteFile(
    allowedDir: string,
    maxWriteBytes: number,
    toolName = "write_file",
): (filePath: string, content: string) => Promise<unknown> {
    /**
     * Writes a text file to the allowed directory, replacing it only if
     * this chat session wrote it earlier.
     *
     * Guards against path-component length violations, control characters,
     * content-size violations, and symlink-based directory escapes before
     * performing any filesystem mutation.
     *
     * @param filePath - Desired path for the new file (relative to allowedDir).
     * @param content - The text content to write.
     * @returns An object with the written path and bytes_written, plus
     *   overwrote: true when an earlier file from this session was replaced.
     */
    return async (filePath: string, content: string): Promise<unknown> => {
        for (const component of filePath.split("/")) {
            if (component.length > MAX_FILENAME_LENGTH) {
                throw new SandboxError(
                    "ValueError",
                    `Filename component "${component.slice(0, 50)}..." exceeds ` +
                        `${MAX_FILENAME_LENGTH} character limit`,
                );
            }
            if (hasControlChars(component)) {
                throw new SandboxError(
                    "ValueError",
                    `Filename "${component}" contains control characters`,
                );
            }
        }
        const contentBytes = Buffer.byteLength(content, "utf-8");
        if (contentBytes > maxWriteBytes) {
            throw new SandboxError(
                "ValueError",
                `Content size ${contentBytes} bytes exceeds write limit of ` +
                    `${maxWriteBytes} bytes (${maxWriteBytes / 1024 / 1024} MB)`,
            );
        }
        // Pre-symlink traversal guard: reject escaping paths before
        // any filesystem mutations.
        const tentative = resolve(allowedDir, filePath);
        assertInside(
            allowedDir,
            tentative,
            `Path "${filePath}" is outside the allowed directory`,
        );
        const relTentative = toForwardSlashes(relative(allowedDir, tentative));
        if (isDeniedPath(relTentative)) {
            throw new SandboxError(
                "OSError",
                `Writing "${filePath}" is not permitted`,
            );
        }
        // Check existing ancestors before mkdir to prevent following
        // pre-existing symlinks outside allowedDir.
        await assertExistingAncestorInside(
            allowedDir,
            tentative,
            `Path "${filePath}" is outside the allowed directory`,
        );
        const parentDir = join(tentative, "..");
        await mkdir(parentDir, { recursive: true });
        // Symlink-safe resolution: verify canonical path stays within allowedDir.
        const resolved = await resolvePath(allowedDir, filePath);
        // Files this session wrote may be replaced; anything else must be new.
        const overwrite = sessionWrittenFiles.has(resolved);
        try {
            await writeFile(resolved, content, {
                encoding: "utf-8",
                flag: overwrite ? "w" : "wx",
            });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "EEXIST") {
                throw await makeFileExistsError(toolName, filePath, tentative);
            }
            throw e;
        }
        sessionWrittenFiles.add(resolved);
        return {
            path: filePath,
            bytes_written: contentBytes,
            ...(overwrite ? { overwrote: true } : {}),
        };
    };
}
