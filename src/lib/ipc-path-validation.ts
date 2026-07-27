// IPC path validation: guards file-path arguments in main-process IPC handlers
// against relative traversal, control characters, and missing filesystem targets.

import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { hasControlChars } from "./monty-sandbox-helpers";

/**
 * Asserts that a remote BAM value received over IPC is an HTTP(S) URL.
 *
 * @param value - BAM URL received from the renderer.
 * @param feature - Feature name used in validation errors.
 */
export function validateIpcRemoteBamUrl(value: string, feature: string): void {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`Invalid ${feature} BAM URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Invalid ${feature} BAM URL: expected HTTP or HTTPS`);
    }
}

/**
 * Asserts that a file path supplied by the renderer is safe to use for a
 * filesystem operation.
 *
 * Three invariants are enforced:
 *  1. The path is absolute (rules out relative traversal such as ../../etc).
 *  2. The path contains no ASCII control characters (rules out null-byte tricks).
 *  3. For "read": the file exists and realpath resolves cleanly (symlinks are
 *     followed; if the target does not exist an ENOENT error is thrown).
 *     For "write": the parent directory exists; the target itself must not be
 *     an existing symlink (prevents writes from following a link to an
 *     unintended location).
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
        try {
            const st = await lstat(filePath);
            if (st.isSymbolicLink()) {
                throw new Error(
                    `Write target must not be an existing symlink: "${filePath}"`,
                );
            }
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            // ENOENT means the file does not exist yet — that is fine for a write target.
        }
    }
}
