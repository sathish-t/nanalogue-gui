// External tool: write_file
// Writes a new text file into the sandboxed directory (no overwrites allowed).
// A name collision raises FileExistsError with a suggested free file name.

import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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

/** Number of numbered names tried when suggesting a free file name. */
const FREE_FILE_NAME_ATTEMPTS = 100;

/**
 * Splits a file name into stem, numeric suffix, and extension, keeping a
 * trailing .gz or .bgz with the extension before it ("calls.vcf.gz" has
 * extension ".vcf.gz"). "results_2.bed" has stem "results" and number "2".
 */
const NUMBERED_FILE_NAME_PATTERN =
    /^(.+?)(?:_(\d+))?((?:\.[^.]+)?\.b?gz|\.[^.]+)?$/i;

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
    const slash = filePath.lastIndexOf("/");
    const dirPrefix = filePath.slice(0, slash + 1);
    const match = NUMBERED_FILE_NAME_PATTERN.exec(filePath.slice(slash + 1));
    if (!match) return undefined;
    const [, stem, existingNumber, extension = ""] = match;
    const firstNumber = existingNumber ? Number(existingNumber) + 1 : 2;
    for (let i = 0; i < FREE_FILE_NAME_ATTEMPTS; i++) {
        const candidate = `${stem}_${firstNumber + i}${extension}`;
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
 * Tells the model that files cannot be overwritten or deleted, suggests a
 * free name, and warns that re-running earlier code repeats writes that
 * already succeeded.
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
            "Existing files cannot be overwritten or deleted in this sandbox. " +
            `${newNameAdvice} If you are re-running earlier code, files it ` +
            "already wrote still exist; skip those writes instead of repeating them.",
    );
}

/**
 * Returns the write_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes that may be written in a single call.
 * @param toolName - Python tool named in the file-exists error; plotting tools pass their own name.
 * @returns An async function callable from Python that creates a new file.
 */
export function makeWriteFile(
    allowedDir: string,
    maxWriteBytes: number,
    toolName = "write_file",
): (filePath: string, content: string) => Promise<unknown> {
    /**
     * Writes a text file to the allowed directory (no overwrites).
     *
     * Guards against path-component length violations, control characters,
     * content-size violations, and symlink-based directory escapes before
     * performing any filesystem mutation.
     *
     * @param filePath - Desired path for the new file (relative to allowedDir).
     * @param content - The text content to write.
     * @returns An object with the written path and bytes_written.
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
        try {
            await writeFile(resolved, content, {
                encoding: "utf-8",
                flag: "wx",
            });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "EEXIST") {
                throw await makeFileExistsError(toolName, filePath, tentative);
            }
            throw e;
        }
        return {
            path: filePath,
            bytes_written: contentBytes,
        };
    };
}
