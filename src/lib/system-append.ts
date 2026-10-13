// Loads the optional SYSTEM_APPEND.md file from an analysis directory.
// Used by both the CLI and Electron GUI to append domain-specific
// instructions to the default system prompt at session start.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { MAX_SYSTEM_PROMPT_BYTES } from "./ai-chat-shared-constants";
import { readBoundedRegularFile } from "./chat-filesystem-input-checks";
import { resolvePath } from "./monty-sandbox-helpers";

// SYSTEM_APPEND.md shares the replacement-system-prompt size ceiling.
export const /** Maximum permitted size in bytes for SYSTEM_APPEND.md. */ MAX_SYSTEM_APPEND_BYTES =
        MAX_SYSTEM_PROMPT_BYTES;

/**
 * Loads the content of SYSTEM_APPEND.md from the analysis directory if present.
 *
 * Uses resolvePath to guard against symlinks pointing outside allowedDir.
 * Returns undefined only when the file is absent. An existing malformed,
 * empty, unsafe, unreadable, or oversized file is rejected explicitly.
 *
 * Case-sensitivity note: the filename "SYSTEM_APPEND.md" is matched exactly.
 * On case-sensitive filesystems (Linux, macOS) only the correct casing is
 * found; on case-insensitive filesystems (Windows NTFS) any casing would
 * match. When Windows support is added, consider doing a case-insensitive
 * directory scan here so behaviour is consistent across platforms.
 *
 * @param allowedDir - Absolute path to the analysis directory.
 * @returns The file content, or undefined.
 * @throws {Error} If SYSTEM_APPEND.md exists but cannot be safely loaded.
 */
export async function loadSystemAppend(
    allowedDir: string,
): Promise<string | undefined> {
    const candidatePath = join(allowedDir, "SYSTEM_APPEND.md");
    try {
        await lstat(candidatePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw new Error("SYSTEM_APPEND.md exists but is not accessible", {
            cause: error,
        });
    }

    try {
        const safePath = await resolvePath(allowedDir, "SYSTEM_APPEND.md");
        const content = await readBoundedRegularFile(safePath, {
            maxBytes: MAX_SYSTEM_APPEND_BYTES,
            notRegularError: "SYSTEM_APPEND.md must be a regular file",
            tooLargeError: "SYSTEM_APPEND.md exceeds the 1 MiB limit",
            unreadableError: "SYSTEM_APPEND.md could not be loaded safely",
        });
        if (content.length === 0) {
            throw new Error("SYSTEM_APPEND.md must not be empty");
        }
        if (content.trim().length === 0) {
            throw new Error(
                "SYSTEM_APPEND.md must not contain only whitespace",
            );
        }
        return content;
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.startsWith("SYSTEM_APPEND.md")
        ) {
            throw error;
        }
        throw new Error("SYSTEM_APPEND.md could not be loaded safely", {
            cause: error,
        });
    }
}
