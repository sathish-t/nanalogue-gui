// External tool: write_file
// Writes a text file into the sandboxed directory. Files this chat session
// wrote can be replaced; any other existing file raises FileExistsError with a
// suggested free file name.

import { randomUUID } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    realpath,
    rename,
    unlink,
    writeFile,
} from "node:fs/promises";
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
 * in the current chat session. Only these files may be overwritten.
 * ChatSession.reset() replaces the set through resetSessionWrittenFiles.
 */
let sessionWrittenFiles = new Set<string>();

/**
 * Forgets which files the current chat session wrote, so they are protected
 * from overwriting again. Called by ChatSession.reset() when a new chat starts.
 *
 * Replaces the set instead of clearing it: a run from the old chat that is
 * still going keeps the old set, so its later writes never become
 * overwritable in the new chat.
 */
export function resetSessionWrittenFiles(): void {
    sessionWrittenFiles = new Set<string>();
}

/** Number of versioned names tried when suggesting a free file name. */
const FREE_FILE_NAME_ATTEMPTS = 100;

/**
 * Splits a file name into stem, version suffix, and extension, keeping a
 * trailing .gz or .bgz with the extension before it ("calls.vcf.gz" has
 * extension ".vcf.gz"). "results-v2.bed" has stem "results" and version "2".
 * Only a "-vN" suffix counts as a version, so numbers that mean something,
 * like the 1 in "region_1.bed", are never changed. Versions longer than nine
 * digits stay in the stem, so they are never printed in exponent form.
 */
const VERSIONED_FILE_NAME_PATTERN =
    /^(.+?)(?:-v(\d{1,9}))?((?:\.[^.]+)?\.b?gz|\.[^.]*)?$/i;

/**
 * Suggests a free file name in the same directory after a write collision.
 *
 * Inserts or increments a "-vN" suffix before the extension, so
 * "region_1.bed" becomes "region_1-v2.bed" and "region_1-v2.bed" becomes
 * "region_1-v3.bed". The name is only free when checked; it is not reserved.
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
    const match = VERSIONED_FILE_NAME_PATTERN.exec(callerPath.slice(slash + 1));
    if (!match) return undefined;
    const [, stem, existingVersion, extension = ""] = match;
    const firstVersion = existingVersion ? Number(existingVersion) + 1 : 2;
    for (let i = 0; i < FREE_FILE_NAME_ATTEMPTS; i++) {
        const candidate = `${stem}-v${firstVersion + i}${extension}`;
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
 * Explains that the file is read-only because the current chat or script did
 * not write it, says files cannot be deleted, then suggests a free name. The
 * wording holds for both the chat's code and a user's /exec script.
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
    return new SandboxError(
        "FileExistsError",
        `${toolName}: "${filePath}" already exists and was not written by ` +
            "the current chat or script (it may be the user's file, or from an " +
            "earlier chat or script), so it is read-only and was not changed. " +
            `Files cannot be deleted. ${await newNameAdvice(filePath, resolvedPath)}`,
    );
}

/**
 * Advises writing to a new name, with a free name when one is found.
 *
 * @param filePath - The colliding path as the caller passed it.
 * @param resolvedPath - The colliding path resolved against allowedDir.
 * @returns The advice sentence.
 */
async function newNameAdvice(
    filePath: string,
    resolvedPath: string,
): Promise<string> {
    const suggestion = await suggestFreeFileName(filePath, resolvedPath);
    return suggestion
        ? `Write to a new name instead, e.g. "${suggestion}" (currently free).`
        : "Write to a new name instead.";
}

/** Result of one write_file call, as returned to Python. */
export interface SandboxWriteFileResult {
    /** The path as the caller passed it. */
    path: string;
    /** Number of UTF-8 bytes written. */
    bytes_written: number;
    /** Present when an existing file from this chat session was replaced. */
    overwrote?: true;
}

/**
 * Replaces an existing file by writing a sibling temporary file and renaming
 * it over the old one. Renaming replaces the directory entry, so hard links
 * to the old file keep the old content. The path is already a real path, so
 * a symlink only appears there if one is swapped in after the existence
 * check; renaming then replaces it instead of writing through it.
 *
 * @param resolvedPath - The real path of the file to replace.
 * @param content - The new text content.
 * @param mode - The old file's permission bits, given to the new file.
 */
async function replaceFileAtomically(
    resolvedPath: string,
    content: string,
    mode: number,
): Promise<void> {
    const tempPath = join(
        dirname(resolvedPath),
        `.write-file-${randomUUID()}.tmp`,
    );
    try {
        await writeFile(tempPath, content, { encoding: "utf-8", flag: "wx" });
        await chmod(tempPath, mode);
        await rename(tempPath, resolvedPath);
    } catch (e) {
        await unlink(tempPath).catch(() => undefined);
        throw e;
    }
}

/**
 * Returns the write_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes that may be written in a single call.
 * @param toolName - Python tool named in the file-exists error; plotting tools pass their own name.
 * @param runWrittenFiles - A user's /exec run passes its own short-lived list of the files it
 *   wrote, so it can overwrite only those and never records into the chat's list. Omit it to use
 *   the chat session's list.
 * @returns An async function callable from Python that writes a file.
 */
export function makeWriteFile(
    allowedDir: string,
    maxWriteBytes: number,
    toolName = "write_file",
    runWrittenFiles?: Set<string>,
): (filePath: string, content: string) => Promise<SandboxWriteFileResult> {
    // Real paths this writer may overwrite, and where it records its files.
    const writtenFiles = runWrittenFiles ?? sessionWrittenFiles;
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
    return async (
        filePath: string,
        content: string,
    ): Promise<SandboxWriteFileResult> => {
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
        // Files this chat (or /exec run) wrote may be replaced; anything else
        // must be new. A recorded file that has since been deleted is
        // created afresh.
        const existing = writtenFiles.has(resolved)
            ? await lstat(resolved).catch((e: NodeJS.ErrnoException) => {
                  if (e.code === "ENOENT") return undefined;
                  throw e;
              })
            : undefined;
        const overwrite = existing !== undefined;
        // The user can protect a chat file by clearing its owner write bit
        // (on Windows, by setting its read-only attribute).
        if (existing && (existing.mode & 0o200) === 0) {
            // Monty does not know PermissionError, so raise its base, OSError.
            throw new SandboxError(
                "OSError",
                `${toolName}: "${filePath}" has been made read-only, so it ` +
                    `was not changed. ${await newNameAdvice(filePath, tentative)}`,
            );
        }
        try {
            if (existing) {
                await replaceFileAtomically(
                    resolved,
                    content,
                    existing.mode & 0o7777,
                ).catch((e: NodeJS.ErrnoException) => {
                    // Hide the host path and temporary file name.
                    throw new SandboxError(
                        "OSError",
                        `${toolName}: could not replace "${filePath}" (${e.code ?? e.message})`,
                    );
                });
            } else {
                await writeFile(resolved, content, {
                    encoding: "utf-8",
                    flag: "wx",
                });
            }
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "EEXIST") {
                throw await makeFileExistsError(toolName, filePath, tentative);
            }
            throw e;
        }
        // Record the real path: before the file existed, resolvePath
        // returned the path through any symlinked folder instead.
        const real = await realpath(resolved);
        writtenFiles.add(real);
        // A file the user's /exec script wrote is the user's, even at a path
        // the chat wrote before.
        if (runWrittenFiles) sessionWrittenFiles.delete(real);
        return {
            path: filePath,
            bytes_written: contentBytes,
            ...(overwrite ? { overwrote: true } : {}),
        };
    };
}
