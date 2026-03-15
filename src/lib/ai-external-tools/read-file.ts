// External tool: read_file
// Reads a text file from the sandboxed directory with optional offset and size limit.

import { open, realpath } from "node:fs/promises";
import { relative } from "node:path";
import {
    isDeniedPath,
    resolvePath,
    SandboxError,
    toForwardSlashes,
} from "../monty-sandbox-helpers";

/**
 * Returns the read_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxReadBytes - Maximum bytes to read per call.
 * @returns An async function callable from Python that returns file content with metadata.
 */
export function makeReadFile(
    allowedDir: string,
    maxReadBytes: number,
): (filePath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Reads a text file from the allowed directory with optional offset and size limit.
     *
     * Resolves allowedDir to its real path before the deny-list check so that
     * relative() always yields a clean subpath even when allowedDir itself
     * contains symlinks (resolved is always a real path).
     *
     * @param filePath - Path to the file to read (relative or absolute within allowedDir).
     * @param opts - Optional options with offset (byte offset) and max_bytes (read cap).
     * @returns An object with content, bytes_read, total_size, and offset.
     */
    return async (
        filePath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        // Block SVG files: they are write-only visual output produced by
        // plotting tools and contain raw XML, not meaningful text data.
        if (filePath.toLowerCase().endsWith(".svg")) {
            throw new SandboxError(
                "ValueError",
                "Cannot read SVG files — they are visual output only. " +
                    "Report the path to the user so they can open it in a browser.",
            );
        }

        const resolved = await resolvePath(allowedDir, filePath);
        const allowedDirReal = await realpath(allowedDir);
        const relResolved = toForwardSlashes(
            relative(allowedDirReal, resolved),
        );
        if (isDeniedPath(relResolved)) {
            // OSError maps to Python's OSError, which Monty accepts.
            // PermissionError is a subclass of OSError in CPython but
            // Monty does not recognise it by name, so we use OSError.
            throw new SandboxError(
                "OSError",
                `Reading "${filePath}" is not permitted`,
            );
        }

        const rawOffset = opts?.offset ?? 0;
        if (
            typeof rawOffset !== "number" ||
            !Number.isFinite(rawOffset) ||
            !Number.isInteger(rawOffset) ||
            rawOffset < 0
        ) {
            throw new SandboxError(
                "ValueError",
                `read_file: offset must be a non-negative integer, got ${String(rawOffset)}`,
            );
        }
        const rawMaxBytes = opts?.max_bytes ?? maxReadBytes;
        if (
            typeof rawMaxBytes !== "number" ||
            !Number.isFinite(rawMaxBytes) ||
            !Number.isInteger(rawMaxBytes) ||
            rawMaxBytes < 0
        ) {
            throw new SandboxError(
                "ValueError",
                `read_file: max_bytes must be a non-negative integer, got ${String(rawMaxBytes)}`,
            );
        }
        const offset = rawOffset;
        const requestedBytes = Math.min(rawMaxBytes, maxReadBytes);
        const fd = await open(resolved, "r");
        try {
            const stat = await fd.stat();
            const totalSize = stat.size;
            const buf = Buffer.alloc(requestedBytes);
            const { bytesRead } = await fd.read(buf, 0, requestedBytes, offset);
            return {
                content: buf.toString("utf-8", 0, bytesRead),
                bytes_read: bytesRead,
                total_size: totalSize,
                offset,
            };
        } finally {
            await fd.close();
        }
    };
}
