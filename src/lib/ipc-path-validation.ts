// IPC path validation: guards file-path arguments in main-process IPC handlers
// against relative traversal, control characters, and missing filesystem targets.

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { hasControlChars } from "./monty-sandbox-helpers";

/**
 * Asserts that a file path supplied by the renderer is safe to use for a
 * filesystem operation.
 *
 * Three invariants are enforced:
 *  1. The path is absolute (rules out relative traversal such as ../../etc).
 *  2. The path contains no ASCII control characters (rules out null-byte tricks).
 *  3. For "read": the file exists and realpath resolves cleanly (symlinks are
 *     followed; if the target does not exist an ENOENT error is thrown).
 *     For "write": the parent directory exists and realpath resolves cleanly
 *     (the output file itself need not exist yet).
 *
 * @param filePath - The path received from the renderer.
 * @param purpose - Whether the path is intended for reading or writing.
 * @throws {Error} If any invariant is violated.
 */
export async function validateIpcFilePath(
    filePath: string,
    purpose: "read" | "write",
): Promise<void> {
    if (!isAbsolute(filePath)) {
        throw new Error(`Path must be absolute, got: "${filePath}"`);
    }
    if (hasControlChars(filePath)) {
        throw new Error(`Path contains control characters: "${filePath}"`);
    }
    if (purpose === "read") {
        await realpath(filePath);
    } else {
        await realpath(dirname(filePath));
    }
}
