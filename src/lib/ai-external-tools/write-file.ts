// External tool: write_file
// Writes a new text file into the sandboxed directory (no overwrites allowed).

import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MAX_FILENAME_LENGTH } from "../ai-chat-constants";
import {
    assertExistingAncestorInside,
    assertInside,
    hasControlChars,
    resolvePath,
    SandboxError,
} from "../monty-sandbox-helpers";

/**
 * Returns the write_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxWriteBytes - Maximum bytes that may be written in a single call.
 * @returns An async function callable from Python that creates a new file.
 */
export function makeWriteFile(
    allowedDir: string,
    maxWriteBytes: number,
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
            await access(resolved);
            throw new SandboxError(
                "FileExistsError",
                `File "${filePath}" already exists. Choose a different name.`,
            );
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await writeFile(resolved, content, "utf-8");
        return {
            path: filePath,
            bytes_written: contentBytes,
        };
    };
}
