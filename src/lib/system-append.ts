// Loads the optional SYSTEM_APPEND.md file from an analysis directory.
// Used by both the CLI and Electron GUI to append domain-specific
// instructions to the default system prompt at session start.

import { readFile, stat } from "node:fs/promises";
import { resolvePath } from "./monty-sandbox-helpers";

// Files larger than this limit are rejected (return undefined) to prevent an
// oversized append from consuming the model's context budget on every turn.
// SYSTEM_APPEND.md is intended for a few paragraphs of domain context, so
// 64 KB is a generous but safe ceiling.
export const /** Maximum permitted size in bytes for SYSTEM_APPEND.md. */ MAX_SYSTEM_APPEND_BYTES =
        64 * 1024;

/**
 * Loads the content of SYSTEM_APPEND.md from the analysis directory if present.
 *
 * Uses resolvePath to guard against symlinks pointing outside allowedDir.
 * Returns undefined if the file is absent, outside the allowed directory,
 * larger than MAX_SYSTEM_APPEND_BYTES, or otherwise unreadable — callers
 * always proceed without a custom append.
 *
 * Case-sensitivity note: the filename "SYSTEM_APPEND.md" is matched exactly.
 * On case-sensitive filesystems (Linux, macOS) only the correct casing is
 * found; on case-insensitive filesystems (Windows NTFS) any casing would
 * match. When Windows support is added, consider doing a case-insensitive
 * directory scan here so behaviour is consistent across platforms.
 *
 * @param allowedDir - Absolute path to the analysis directory.
 * @returns The file content, or undefined.
 */
export async function loadSystemAppend(
    allowedDir: string,
): Promise<string | undefined> {
    try {
        const safePath = await resolvePath(allowedDir, "SYSTEM_APPEND.md");
        const fileStat = await stat(safePath);
        if (fileStat.size > MAX_SYSTEM_APPEND_BYTES) {
            return undefined;
        }
        return await readFile(safePath, "utf-8");
    } catch {
        // File absent, symlink escapes the directory, or unreadable —
        // treat all of these identically: no custom append.
        return undefined;
    }
}
