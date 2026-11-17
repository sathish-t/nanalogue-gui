// External tool: read_file
// Reads a text file from the sandboxed directory with optional offset and size limit.
// Files ending in .gz (including multi-member BGZF such as .vcf.gz) are
// decompressed as a stream; offset, max_bytes and total_size then refer to
// the decompressed text.

import { createReadStream } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { relative } from "node:path";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";
import {
    isDeniedPath,
    resolvePath,
    SandboxError,
    toForwardSlashes,
} from "../monty-sandbox-helpers";

/** One page of decompressed gzip text, as returned by readGzipPage. */
interface GzipPage {
    /** Buffer holding the page; only the first pageBytes bytes are valid. */
    page: Buffer;
    /** Number of decompressed bytes in the page. */
    pageBytes: number;
    /** Total decompressed size of the whole file in bytes. */
    totalSize: number;
}

/**
 * Decompresses a gzip file as a stream and returns one page of its text.
 *
 * Node's gunzip continues across concatenated gzip members, so BGZF files
 * are read in full. Only the requested page is kept in memory; the rest of
 * the stream is counted so total_size reports the decompressed size.
 *
 * @param resolvedPath - Real path of the gzip file inside the allowed directory.
 * @param filePath - Path as given by the caller, used in error messages.
 * @param offset - Byte offset into the decompressed text.
 * @param requestedBytes - Maximum decompressed bytes to return.
 * @param maxDecompressedBytes - Ceiling on total decompressed bytes processed.
 * @returns The page buffer, bytes in the page, and total decompressed size.
 */
async function readGzipPage(
    resolvedPath: string,
    filePath: string,
    offset: number,
    requestedBytes: number,
    maxDecompressedBytes: number,
): Promise<GzipPage> {
    const page = Buffer.alloc(requestedBytes);
    let pageBytes = 0;
    let totalSize = 0;
    const gunzip = pipeline(
        createReadStream(resolvedPath),
        createGunzip(),
        () => {
            // Errors surface through the async iteration below.
        },
    );
    try {
        for await (const chunk of gunzip as AsyncIterable<Buffer>) {
            const chunkStart = totalSize;
            totalSize += chunk.length;
            if (totalSize > maxDecompressedBytes) {
                throw new SandboxError(
                    "ValueError",
                    `read_file: "${filePath}" decompresses to more than ` +
                        `${maxDecompressedBytes} bytes, the sandbox limit for gzip input`,
                );
            }
            const from = Math.max(offset, chunkStart);
            const to = Math.min(offset + requestedBytes, totalSize);
            if (to > from) {
                chunk.copy(
                    page,
                    from - offset,
                    from - chunkStart,
                    to - chunkStart,
                );
                pageBytes = to - offset;
            }
        }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === "string" && code.startsWith("Z_")) {
            throw new SandboxError(
                "ValueError",
                `read_file: "${filePath}" is not valid gzip data (${String((error as Error).message)})`,
            );
        }
        throw error;
    }
    return { page, pageBytes, totalSize };
}

/**
 * Returns the read_file tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxReadBytes - Maximum bytes to read per call.
 * @param maxDecompressedBytes - Ceiling on total decompressed bytes for one .gz file.
 * @returns An async function callable from Python that returns file content with metadata.
 */
export function makeReadFile(
    allowedDir: string,
    maxReadBytes: number,
    maxDecompressedBytes: number,
): (filePath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Reads a text file from the allowed directory with optional offset and size limit.
     * A .gz file is decompressed first; offset and sizes refer to its text.
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
        if (filePath.toLowerCase().endsWith(".gz")) {
            const { page, pageBytes, totalSize } = await readGzipPage(
                resolved,
                filePath,
                offset,
                requestedBytes,
                maxDecompressedBytes,
            );
            return {
                content: page.toString("utf-8", 0, pageBytes),
                bytes_read: pageBytes,
                total_size: totalSize,
                offset,
            };
        }
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
