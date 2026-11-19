// Utility helpers for monty-sandbox: path security, option translation,
// output serialization, and directory listing.

import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ReadOptions, WindowOptions } from "@nanalogue/node";
import {
    MAX_LS_ENTRIES,
    MAX_OUTPUT_BYTES,
    MIN_OUTPUT_BYTES,
} from "./ai-chat-constants";

/** Case-insensitive filename suffixes blocked from sandbox reads and listings. */
const SENSITIVE_FILE_SUFFIXES = [
    ".cer",
    ".credentials",
    ".crt",
    ".gpg",
    ".key",
    ".p12",
    ".pem",
    ".pfx",
] as const;

/** Case-insensitive exact filenames blocked from sandbox reads and listings. */
const SENSITIVE_FILE_NAMES = new Set([
    ".env",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
]);

/** File-path predicate used by recursive directory listing filters. */
type FilePathMatcher = (filePath: string) => boolean;

/**
 * Checks a relative path against the sandbox sensitive-file deny-list.
 * Matching is case-insensitive and applies at every directory depth.
 *
 * @param filePath - Relative file path using either platform separator.
 * @returns True for private keys, credentials, dotenv files, and certificates.
 */
export function isDeniedPath(filePath: string): boolean {
    const filename = toForwardSlashes(filePath)
        .split("/")
        .at(-1)
        ?.toLowerCase();
    if (!filename) {
        return false;
    }
    return (
        SENSITIVE_FILE_NAMES.has(filename) ||
        filename.startsWith(".env.") ||
        SENSITIVE_FILE_SUFFIXES.some((suffix) => filename.endsWith(suffix))
    );
}

/**
 * Normalises a file path for deny-list matching by converting backslashes to
 * forward slashes. This keeps sandbox path predicates and user glob matching
 * platform-independent.
 *
 * @param p - The relative path to normalise.
 * @returns The path with all backslashes replaced by forward slashes.
 */
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Error class with a Python-compatible exception type name.
 * The Monty drive loop uses err.name to map JS errors to Python exceptions.
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

// The limit option is not listed because toReadOptions clamps it to the record cap.
export const /** Python keyword names of the shared BAM read options, mapped to their camelCase ReadOptions field. */ BAM_READ_OPTION_FIELDS =
        {
            offset: "offset",
            sample_fraction: "sampleFraction",
            sample_seed: "sampleSeed",
            region: "region",
            full_region: "fullRegion",
            min_seq_len: "minSeqLen",
            min_align_len: "minAlignLen",
            read_id_set: "readIdSet",
            threads: "threads",
            read_filter: "readFilter",
            mapq_filter: "mapqFilter",
            exclude_mapq_unavail: "excludeMapqUnavail",
            tag: "tag",
            mod_strand: "modStrand",
            min_mod_qual: "minModQual",
            reject_mod_qual_non_inclusive: "rejectModQualNonInclusive",
            trim_read_ends_mod: "trimReadEndsMod",
            base_qual_filter_mod: "baseQualFilterMod",
            mod_region: "modRegion",
        } as const satisfies Record<string, keyof ReadOptions>;

export const /** Python keyword names of the window_reads-only options, mapped to their WindowOptions field. */ WINDOW_OPTION_FIELDS =
        {
            win: "win",
            step: "step",
            win_op: "winOp",
        } as const satisfies Record<string, keyof WindowOptions>;

// Two names are added to the shared read options by hand. The limit option is
// accepted but is not in BAM_READ_OPTION_FIELDS, because toReadOptions caps it
// at the tool's record limit instead of copying it across. The treat_as_url
// option is not a read option; it is accepted only so rejectTreatAsUrl can
// raise its "URL access is not permitted" error instead of an
// unexpected-keyword TypeError.
export const /** Keyword-only parameters of read_info, bam_mods and seq_table: limit, the shared BAM read options, and treat_as_url (which is rejected). */ BAM_TOOL_KEYWORDS =
        ["limit", ...Object.keys(BAM_READ_OPTION_FIELDS), "treat_as_url"];

/**
 * Copies each listed snake_case Python option to its camelCase field.
 * Options that were not passed are copied as undefined.
 *
 * @param fields - Python keyword names mapped to option field names.
 * @param opts - The snake_case options from sandbox code.
 * @returns The camelCase fields.
 */
function copyOptionFields(
    fields: Record<string, string>,
    opts?: Record<string, unknown>,
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(fields).map(([pythonName, field]) => [
            field,
            opts?.[pythonName],
        ]),
    );
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
        ...copyOptionFields(BAM_READ_OPTION_FIELDS, opts),
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
        ...copyOptionFields(WINDOW_OPTION_FIELDS, opts),
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
        pattern?: FilePathMatcher;
        /** Glob matcher function to exclude files (deny-list). */
        deny?: FilePathMatcher;
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
        // Normalise paths before applying platform-independent filters.
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
                        !options.deny?.(resolvedRel)
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
                !options.deny?.(resolvedRel)
            ) {
                results.push(resolvedRel);
            }
        }
    }
    return { files: results, capped };
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
        const json = JSON.stringify(value);
        if (json !== undefined) return { ok: true, json };
    } catch {
        // Fall through to the bounded non-serializable representation.
    }
    return {
        ok: false,
        fallback: '{"_error":"cyclic or non-serializable value"}',
    };
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
