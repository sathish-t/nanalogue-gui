// Utility helpers for monty-sandbox: path security, option translation,
// output gating, and directory listing.

import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ReadOptions, WindowOptions } from "@nanalogue/node";
import picomatch from "picomatch";
import {
    MAX_LS_ENTRIES,
    MAX_OUTPUT_BYTES,
    MIN_OUTPUT_BYTES,
    SENSITIVE_FILE_DENY_LIST,
} from "./ai-chat-constants";

export const /** Precomputed deny-list matcher for sensitive file paths, compiled once at module load. Uses dot:true (hidden dirs) and nocase:true (case-insensitive file systems). */ isDeniedPath =
        picomatch([...SENSITIVE_FILE_DENY_LIST], {
            dot: true,
            nocase: true,
        });

/**
 * Normalises a file path for deny-list matching by converting backslashes to
 * forward slashes. Picomatch patterns always use forward slashes, so without
 * this step nested paths on Windows (e.g. "sub\id_rsa") would escape the
 * deny-list even though they match the glob "** /id_rsa".
 *
 * @param p - The relative path to normalise.
 * @returns The path with all backslashes replaced by forward slashes.
 */
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Error class with a Python-compatible exception type name.
 * Monty's runMontyAsync uses err.name to map JS errors to Python exceptions.
 */
export class SandboxError extends Error {
    /**
     * Creates a SandboxError with the given Python exception type and message.
     *
     * @param pythonType - Python exception type name (e.g. "ValueError", "PermissionError").
     * @param message - The error message.
     */
    constructor(pythonType: string, message: string) {
        super(message);
        this.name = pythonType;
    }
}

/**
 * Checks whether a string contains ASCII control characters (0x00-0x1F or 0x7F).
 *
 * @param str - The string to check.
 * @returns True if the string contains control characters.
 */
export function hasControlChars(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
            return true;
        }
    }
    return false;
}

/**
 * Derives maxOutputBytes from the user's context window budget.
 * Uses 15% of the budget (at ~4 bytes/token), clamped to [4 KB, 80 KB].
 *
 * @param contextBudgetTokens - The context window size in tokens.
 * @returns The derived max output size in bytes.
 */
export function deriveMaxOutputBytes(contextBudgetTokens: number): number {
    const contextBudgetBytes = contextBudgetTokens * 4;
    const derived = Math.round(contextBudgetBytes * 0.15);
    return Math.max(MIN_OUTPUT_BYTES, Math.min(MAX_OUTPUT_BYTES, derived));
}

/**
 * Walks up from targetPath and verifies the deepest existing ancestor
 * has a realpath inside allowedDir. Prevents mkdir from following
 * pre-existing symlinks outside the sandbox before resolvePath can catch them.
 *
 * @param allowedDir - The base directory all paths must stay within.
 * @param targetPath - The absolute path whose existing ancestors to check.
 * @param errorMessage - The error message to throw if validation fails.
 */
export async function assertExistingAncestorInside(
    allowedDir: string,
    targetPath: string,
    errorMessage: string,
): Promise<void> {
    const allowedDirReal = await realpath(allowedDir);
    let current = resolve(targetPath, "..");
    while (true) {
        try {
            const real = await realpath(current);
            assertInside(allowedDirReal, real, errorMessage);
            return;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                const parent = resolve(current, "..");
                /* c8 ignore next -- reaching the filesystem root requires traversing to / */
                if (parent === current) return; // reached filesystem root
                current = parent;
                continue;
            }
            throw e;
        }
    }
}

/**
 * Asserts that candidate is inside base, throwing if it escapes via traversal.
 *
 * @param base - The base directory the candidate must stay within.
 * @param candidate - The absolute path to validate.
 * @param errorMessage - The error message to throw if validation fails.
 */
export function assertInside(
    base: string,
    candidate: string,
    errorMessage: string,
): void {
    const rel = relative(base, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new SandboxError("OSError", errorMessage);
    }
}

/**
 * Resolves a file path within the allowed directory, guarding against path traversal.
 * Uses realpath to resolve symlinks so symlinks outside the allowed directory are rejected.
 *
 * @param allowedDir - The base directory all paths must resolve within.
 * @param filePath - The relative path to resolve.
 * @returns The resolved absolute path.
 */
export async function resolvePath(
    allowedDir: string,
    filePath: string,
): Promise<string> {
    if (filePath.includes("://")) {
        throw new SandboxError(
            "ValueError",
            `Path "${filePath}" looks like a URL — only local file paths are permitted`,
        );
    }
    const errorMessage = `Path "${filePath}" is outside the allowed directory`;
    const resolved = resolve(allowedDir, filePath);
    assertInside(allowedDir, resolved, errorMessage);
    const allowedDirReal = await realpath(allowedDir);
    let candidateReal: string;
    try {
        candidateReal = await realpath(resolved);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            const parentReal = await realpath(resolve(resolved, ".."));
            assertInside(allowedDirReal, parentReal, errorMessage);
            return resolved;
        }
        /* c8 ignore next -- non-ENOENT realpath errors (e.g. EACCES) are not practical to test */
        throw e;
    }
    assertInside(allowedDirReal, candidateReal, errorMessage);
    return candidateReal;
}

/**
 * Rejects treat_as_url from sandbox code (network escape prevention).
 *
 * @param opts - The options object that may contain treat_as_url.
 */
export function rejectTreatAsUrl(opts?: Record<string, unknown>): void {
    if (opts?.treat_as_url) {
        throw new SandboxError(
            "OSError",
            "URL access is not permitted in sandbox",
        );
    }
}

/**
 * Translates snake_case Python kwargs to camelCase ReadOptions for nanalogue/node.
 *
 * @param resolved - The resolved BAM file path.
 * @param opts - The snake_case options from sandbox code.
 * @param limitOverride - Default limit when opts.limit is absent.
 * @returns A ReadOptions object for nanalogue/node.
 */
export function toReadOptions(
    resolved: string,
    opts?: Record<string, unknown>,
    limitOverride?: number,
): ReadOptions {
    return {
        bamPath: resolved,
        limit:
            limitOverride !== undefined
                ? Math.min(
                      (opts?.limit as number | undefined) ?? limitOverride,
                      limitOverride,
                  )
                : (opts?.limit as number | undefined),
        offset: opts?.offset as number | undefined,
        sampleFraction: opts?.sample_fraction as number | undefined,
        sampleSeed: opts?.sample_seed as number | undefined,
        region: opts?.region as string | undefined,
        fullRegion: opts?.full_region as boolean | undefined,
        minSeqLen: opts?.min_seq_len as number | undefined,
        minAlignLen: opts?.min_align_len as number | undefined,
        readIdSet: opts?.read_id_set as string[] | undefined,
        readFilter: opts?.read_filter as string | undefined,
        mapqFilter: opts?.mapq_filter as number | undefined,
        excludeMapqUnavail: opts?.exclude_mapq_unavail as boolean | undefined,
        tag: opts?.tag as string | undefined,
        modStrand: opts?.mod_strand as string | undefined,
        minModQual: opts?.min_mod_qual as number | undefined,
        rejectModQualNonInclusive: opts?.reject_mod_qual_non_inclusive as
            | number[]
            | undefined,
        trimReadEndsMod: opts?.trim_read_ends_mod as number | undefined,
        baseQualFilterMod: opts?.base_qual_filter_mod as number | undefined,
        modRegion: opts?.mod_region as string | undefined,
    } as ReadOptions;
}

/**
 * Translates snake_case Python kwargs to camelCase WindowOptions for nanalogue/node.
 *
 * @param resolved - The resolved BAM file path.
 * @param opts - The snake_case options from sandbox code.
 * @param limitOverride - Default limit when opts.limit is absent.
 * @returns A WindowOptions object for nanalogue/node.
 */
export function toWindowOptions(
    resolved: string,
    opts?: Record<string, unknown>,
    limitOverride?: number,
): WindowOptions {
    return {
        ...toReadOptions(resolved, opts, limitOverride),
        win: opts?.win as number | undefined,
        step: opts?.step as number | undefined,
        winOp: opts?.win_op as "density" | "grad_density" | undefined,
    } as WindowOptions;
}

/**
 * Defense-in-depth record limit check. Primary enforcement is via the native limit
 * parameter in nanalogue/node; this is a backstop.
 *
 * @param result - The array of records returned from nanalogue/node.
 * @param fnName - The function name for error messages.
 * @param maxRecords - The maximum allowed record count.
 */
export function enforceRecordLimit(
    result: unknown[],
    fnName: string,
    maxRecords: number,
): void {
    if (result.length > maxRecords) {
        throw new SandboxError(
            "ValueError",
            `${fnName} returned ${result.length} records, exceeds limit of ${maxRecords}. ` +
                "Use region, sample_fraction, or stricter filters to reduce result size. " +
                "Or write to file and read back the first few lines.",
        );
    }
}

/**
 * Enforces data size limit for line-oriented string outputs (e.g. TSV).
 * Truncates at a newline boundary so each kept line remains complete.
 *
 * @param data - The line-oriented string to check.
 * @param fnName - The function name for the truncation notice.
 * @param maxBytes - The maximum allowed byte size.
 * @returns The original or truncated string.
 */
export function enforceDataSizeLimit(
    data: string,
    fnName: string,
    maxBytes: number,
): string {
    if (Buffer.byteLength(data, "utf-8") <= maxBytes) {
        return data;
    }
    const lastNewline = data.lastIndexOf("\n", maxBytes);
    const cutPoint = lastNewline > 0 ? lastNewline : maxBytes;
    const totalLines = data.split("\n").length;
    const keptLines = data.slice(0, cutPoint).split("\n").length;
    return (
        data.slice(0, cutPoint) +
        `\n[TRUNCATED by ${fnName}: showing ${keptLines} of ${totalLines} lines. ` +
        "Use region, sample_fraction, win/step, or stricter filters to reduce result size. " +
        "Or write to file and read back the first few lines. ]"
    );
}

/**
 * Recursively lists files under dir, returning paths relative to allowedDir.
 * Supports optional glob filtering. Hard-capped at MAX_LS_ENTRIES.
 *
 * @param dir - The directory to list.
 * @param allowedDir - The root allowed directory.
 * @param options - Optional pattern matcher, max entries, and visited set.
 * @param options.pattern - Glob matcher function to filter files.
 * @param options.deny - Glob matcher function to exclude files (deny-list).
 * @param options.maxEntries - Maximum number of entries to return.
 * @param options.visited - Set of visited inodes for symlink cycle detection.
 * @returns An object with the file list and whether the cap was hit.
 */
export async function listFilesRecursive(
    dir: string,
    allowedDir: string,
    options: {
        /** Glob matcher function to filter files. */
        pattern?: picomatch.Matcher;
        /** Glob matcher function to exclude files (deny-list). */
        deny?: picomatch.Matcher;
        /** Maximum number of entries to return. */
        maxEntries?: number;
        /** Set of visited inodes for symlink cycle detection. */
        visited?: Set<string>;
    } = {},
): Promise<{
    /** The list of relative file paths. */
    files: string[];
    /** Whether the listing was capped at the maximum. */
    capped: boolean;
}> {
    const maxEntries = options.maxEntries ?? MAX_LS_ENTRIES;
    const visited = options.visited ?? new Set<string>();
    const results: string[] = [];
    let capped = false;

    const dirReal = await realpath(dir);
    if (visited.has(dirReal)) {
        return { files: results, capped: false };
    }
    visited.add(dirReal);

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (results.length >= maxEntries) {
            capped = true;
            break;
        }
        const fullPath = join(dir, entry.name);
        const relPath = relative(allowedDir, fullPath);
        let resolved: string;
        try {
            resolved = await resolvePath(allowedDir, relPath);
        } catch {
            continue;
        }
        // Normalise to forward slashes so the deny-list picomatch patterns
        // match correctly on Windows where relative() uses backslashes.
        const resolvedRel = toForwardSlashes(relative(allowedDir, resolved));
        if (entry.isDirectory() || entry.isSymbolicLink()) {
            try {
                const stat = await lstat(resolved);
                if (stat.isDirectory()) {
                    const remaining = maxEntries - results.length;
                    const sub = await listFilesRecursive(resolved, allowedDir, {
                        pattern: options.pattern,
                        deny: options.deny,
                        maxEntries: remaining,
                        visited,
                    });
                    results.push(...sub.files);
                    if (sub.capped) {
                        capped = true;
                        break;
                    }
                } else if (stat.isFile()) {
                    if (
                        (!options.pattern || options.pattern(resolvedRel)) &&
                        (!options.deny || !options.deny(resolvedRel))
                    ) {
                        results.push(resolvedRel);
                    }
                }
            } catch {
                // Ignore unreadable entries (permission errors, broken symlinks)
            }
        } else if (entry.isFile()) {
            if (
                (!options.pattern || options.pattern(resolvedRel)) &&
                (!options.deny || !options.deny(resolvedRel))
            ) {
                results.push(resolvedRel);
            }
        }
    }
    return { files: results, capped };
}

/**
 * Slices a UTF-8 string to at most maxBytes bytes, backing off to a codepoint
 * boundary so the result is always valid UTF-8. Returns the original string
 * unchanged when it is already within the limit.
 *
 * @param s - The string to slice.
 * @param maxBytes - Maximum byte length of the returned string.
 * @returns The (possibly shorter) string.
 */
export function safeUtf8Slice(s: string, maxBytes: number): string {
    const buf = Buffer.from(s, "utf-8");
    if (buf.length <= maxBytes) return s;
    let end = maxBytes;
    // Back off past UTF-8 continuation bytes (10xxxxxx) to land on a
    // codepoint boundary and never emit a partial multi-byte character.
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
    return buf.subarray(0, end).toString("utf-8");
}

/**
 * Safe JSON.stringify that handles cyclic references.
 *
 * @param value - The value to serialize.
 * @returns An ok result with JSON string, or a fallback error string.
 */
export function safeStringify(value: unknown):
    | {
          /** Indicates successful serialization. */
          ok: true;
          /** The JSON-serialized string. */
          json: string;
      }
    | {
          /** Indicates serialization failure. */
          ok: false;
          /** The fallback error description. */
          fallback: string;
      } {
    try {
        return { ok: true, json: JSON.stringify(value) };
    } catch {
        return {
            ok: false,
            fallback: '{"_error":"cyclic or non-serializable value"}',
        };
    }
}

/**
 * Gates output size by truncating at semantic boundaries if it exceeds maxBytes.
 * Returns valid, parseable data with truncation metadata.
 *
 * @param value - The value to gate.
 * @param maxBytes - The maximum output size in bytes.
 * @returns An object with the gated value and whether truncation occurred.
 */
export function gateOutputSize(
    value: unknown,
    maxBytes: number,
): {
    /** The gated output value, possibly truncated. */
    gated: unknown;
    /** Whether the output was truncated. */
    truncated: boolean;
} {
    const result = safeStringify(value);

    if (!result.ok) {
        return { gated: result.fallback, truncated: true };
    }

    const serialized = result.json;
    if (Buffer.byteLength(serialized, "utf-8") <= maxBytes) {
        return { gated: value, truncated: false };
    }

    const serializedBytes = Buffer.byteLength(serialized, "utf-8");

    if (Array.isArray(value)) {
        const items: unknown[] = [];
        let currentSize = 2;
        for (const item of value) {
            const itemResult = safeStringify(item);
            const itemBytes = itemResult.ok
                ? Buffer.byteLength(itemResult.json, "utf-8") + 1
                : 64;
            if (currentSize + itemBytes > maxBytes) break;
            items.push(item);
            currentSize += itemBytes;
        }
        return {
            gated: {
                items,
                _truncated: {
                    kept: items.length,
                    total: value.length,
                    dropped: value.length - items.length,
                    total_bytes: serializedBytes,
                },
            },
            truncated: true,
        };
    }

    if (typeof value === "string") {
        const lastNewline = value.lastIndexOf("\n", maxBytes);
        const cutPoint = lastNewline > 0 ? lastNewline : maxBytes;
        const lines = value.slice(0, cutPoint);
        const totalLines = value.split("\n").length;
        const keptLines = lines.split("\n").length;
        return {
            gated:
                `${lines}\n[TRUNCATED: showing ${keptLines} of ${totalLines} lines, ` +
                `${serializedBytes} bytes total]`,
            truncated: true,
        };
    }

    if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const truncatedObj: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
            const valResult = safeStringify(val);
            const valBytes = valResult.ok
                ? Buffer.byteLength(valResult.json, "utf-8")
                : 64;
            if (Array.isArray(val) && valBytes > maxBytes / 4) {
                truncatedObj[key] = gateOutputSize(
                    val,
                    Math.floor(maxBytes / 4),
                ).gated;
            } else if (typeof val === "string" && valBytes > maxBytes / 4) {
                truncatedObj[key] = gateOutputSize(
                    val,
                    Math.floor(maxBytes / 4),
                ).gated;
            } else {
                truncatedObj[key] = val;
            }
        }
        const objResult = safeStringify(truncatedObj);
        const objSerialized = objResult.ok
            ? objResult.json
            : objResult.fallback;
        if (Buffer.byteLength(objSerialized, "utf-8") > maxBytes) {
            const truncStr = objSerialized.slice(0, maxBytes);
            return {
                gated:
                    truncStr +
                    `\n[TRUNCATED: object exceeded ${maxBytes} bytes after structural truncation]`,
                truncated: true,
            };
        }
        return { gated: truncatedObj, truncated: true };
    }

    return { gated: value, truncated: false };
}

/**
 * Recursively converts Map instances (Monty's Python dict representation) to plain objects.
 * Also converts nested Maps within arrays and objects.
 *
 * @param value - The value returned from Monty.
 * @returns The value with all Maps replaced by plain objects.
 */
export function convertMaps(value: unknown): unknown {
    if (value instanceof Map) {
        const obj: Record<string, unknown> = {};
        for (const [key, val] of value) {
            obj[String(key)] = convertMaps(val);
        }
        return obj;
    }
    if (Array.isArray(value)) {
        return value.map(convertMaps);
    }
    if (typeof value === "object" && value !== null) {
        const obj: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(
            value as Record<string, unknown>,
        )) {
            obj[key] = convertMaps(val);
        }
        return obj;
    }
    return value;
}
