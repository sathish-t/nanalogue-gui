// Monty sandbox wrapper for AI Chat mode.
// Encapsulates @pydantic/monty with @nanalogue/node external functions and security guards.

import {
    access,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ReadOptions, WindowOptions } from "@nanalogue/node";
import {
    bamMods,
    peek as peekFn,
    readInfo,
    seqTable,
    windowReads,
} from "@nanalogue/node";
import {
    Monty,
    MontyRuntimeError,
    MontySnapshot,
    MontySyntaxError,
} from "@pydantic/monty";
import picomatch from "picomatch";
import {
    AI_CHAT_OUTPUT_DIR,
    DEFAULT_MAX_ALLOCATIONS,
    DEFAULT_MAX_DURATION_SECS,
    DEFAULT_MAX_MEMORY,
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_READ_BYTES,
    DEFAULT_MAX_RECORDS_BAM_MODS,
    DEFAULT_MAX_RECORDS_READ_INFO,
    DEFAULT_MAX_RECORDS_SEQ_TABLE,
    DEFAULT_MAX_RECORDS_WINDOW_READS,
    DEFAULT_MAX_WRITE_BYTES,
    EXTERNAL_FUNCTIONS,
    MAX_FILENAME_LENGTH,
    MAX_LS_ENTRIES,
    MAX_OUTPUT_BYTES,
    MAX_PRINT_CAPTURE_BYTES,
    MIN_OUTPUT_BYTES,
} from "./ai-chat-constants";
import type { SandboxOptions, SandboxResult } from "./chat-types";

/**
 * Error class with a Python-compatible exception type name.
 * Monty's runMontyAsync uses err.name to map JS errors to Python exceptions.
 */
class SandboxError extends Error {
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
function hasControlChars(str: string): boolean {
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
 * Asserts that candidate is inside base, throwing if it escapes via traversal.
 *
 * @param base - The base directory the candidate must stay within.
 * @param candidate - The absolute path to validate.
 * @param errorMessage - The error message to throw if validation fails.
 */
function assertInside(
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
        limit: (opts?.limit as number | undefined) ?? limitOverride,
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
function enforceRecordLimit(
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
function enforceDataSizeLimit(
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
 * @param options.maxEntries - Maximum number of entries to return.
 * @param options.visited - Set of visited inodes for symlink cycle detection.
 * @returns An object with the file list and whether the cap was hit.
 */
async function listFilesRecursive(
    dir: string,
    allowedDir: string,
    options: {
        /** Glob matcher function to filter files. */
        pattern?: picomatch.Matcher;
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
        const resolvedRel = relative(allowedDir, resolved);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
            try {
                const stat = await lstat(resolved);
                if (stat.isDirectory()) {
                    const remaining = maxEntries - results.length;
                    const sub = await listFilesRecursive(resolved, allowedDir, {
                        pattern: options.pattern,
                        maxEntries: remaining,
                        visited,
                    });
                    results.push(...sub.files);
                    if (sub.capped) {
                        capped = true;
                        break;
                    }
                } else if (stat.isFile()) {
                    if (!options.pattern || options.pattern(resolvedRel)) {
                        results.push(resolvedRel);
                    }
                }
            } catch {
                // Ignore unreadable entries (permission errors, broken symlinks)
            }
        } else if (entry.isFile()) {
            if (!options.pattern || options.pattern(resolvedRel)) {
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
function convertMaps(value: unknown): unknown {
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

// --- runMontyAsyncWithPrint ---
// Vendored reimplementation of runMontyAsync from @pydantic/monty that
// forwards printCallback to Monty.start(). The upstream runMontyAsync omits
// printCallback from RunMontyAsyncOptions. If Monty ships native support,
// remove this function and use the upstream version.
// TODO: track upstream Monty support for printCallback in runMontyAsync.

/**
 * Runs a Monty instance asynchronously with printCallback support.
 * Reimplements the runMontyAsync loop (~45 lines) to pass printCallback to start().
 *
 * @param montyRunner - The Monty instance to execute.
 * @param options - Execution options including limits, external functions, and printCallback.
 * @param options.inputs - Input values to inject into the Python namespace.
 * @param options.externalFunctions - External functions callable from Python.
 * @param options.limits - Resource limits for the Monty VM.
 * @param options.limits.maxDurationSecs - Maximum execution duration in seconds.
 * @param options.limits.maxMemory - Maximum memory usage in bytes.
 * @param options.limits.maxAllocations - Maximum number of allocations.
 * @param options.printCallback - Callback invoked when Python calls print().
 * @returns The final output value from the Monty execution.
 */
async function runMontyAsyncWithPrint(
    montyRunner: Monty,
    options: {
        /** Input values to inject into the Python namespace. */
        inputs?: Record<string, unknown>;
        /** External functions callable from Python. */
        externalFunctions?: Record<string, (...args: unknown[]) => unknown>;
        /** Resource limits for the Monty VM. */
        limits?: {
            /** Maximum wall-clock time in seconds before the VM is terminated. */
            maxDurationSecs?: number;
            /** Maximum memory in bytes the VM is allowed to allocate. */
            maxMemory?: number;
            /** Maximum number of heap allocations before the VM is terminated. */
            maxAllocations?: number;
        };
        /** Callback for captured print() output. */
        printCallback?: (stream: string, text: string) => void;
    },
): Promise<unknown> {
    const { inputs, externalFunctions = {}, limits, printCallback } = options;
    let progress = montyRunner.start({
        inputs,
        limits,
        printCallback,
    });
    while (progress instanceof MontySnapshot) {
        const snapshot = progress;
        const funcName = snapshot.functionName;
        const extFunction = externalFunctions[funcName];
        if (!extFunction) {
            progress = snapshot.resume({
                exception: {
                    type: "KeyError",
                    message: `"External function '${funcName}' not found"`,
                },
            });
            continue;
        }
        try {
            let result = extFunction(...snapshot.args, snapshot.kwargs);
            if (
                result &&
                typeof (result as Promise<unknown>).then === "function"
            ) {
                result = await (result as Promise<unknown>);
            }
            progress = snapshot.resume({ returnValue: result });
        } catch (error) {
            const err = error as Error;
            progress = snapshot.resume({
                exception: {
                    type: err.name || "RuntimeError",
                    message: err.message || String(error),
                },
            });
        }
    }
    return progress.output;
}

/**
 * Runs Python code in the Monty sandbox with all external functions bound.
 *
 * @param code - The Python code to execute.
 * @param allowedDir - The allowed directory for file operations.
 * @param options - Sandbox configuration options.
 * @returns A SandboxResult with the execution outcome.
 */
export async function runSandboxCode(
    code: string,
    allowedDir: string,
    options: SandboxOptions = {},
): Promise<SandboxResult> {
    const {
        maxDurationSecs = DEFAULT_MAX_DURATION_SECS,
        maxMemory = DEFAULT_MAX_MEMORY,
        maxRecordsReadInfo = DEFAULT_MAX_RECORDS_READ_INFO,
        maxRecordsBamMods = DEFAULT_MAX_RECORDS_BAM_MODS,
        maxRecordsWindowReads = DEFAULT_MAX_RECORDS_WINDOW_READS,
        maxRecordsSeqTable = DEFAULT_MAX_RECORDS_SEQ_TABLE,
        maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    } = options;

    let continueThinkingCalled = false;
    const prints: string[] = [];
    let printBytes = 0;

    try {
        const m = new Monty(code, {
            externalFunctions: [...EXTERNAL_FUNCTIONS],
        });

        /**
         * Wraps external functions to convert plain JS Error to Monty-compatible SandboxError.
         * Monty only accepts specific Python exception type names (e.g. RuntimeError, ValueError).
         *
         * @param fns - Map of function names to their implementations.
         * @returns A new map with each function wrapped in SandboxError conversion.
         */
        function wrapForMonty(
            fns: Record<string, (...args: never[]) => unknown>,
        ): Record<string, (...args: unknown[]) => unknown> {
            const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
            for (const [name, fn] of Object.entries(fns)) {
                /**
                 * Wraps an external function to convert native errors into SandboxErrors.
                 *
                 * @param args - The arguments forwarded to the external function.
                 * @returns The result of the external function call.
                 */
                wrapped[name] = async (...args: unknown[]) => {
                    try {
                        return await (
                            fn as (...a: unknown[]) => Promise<unknown>
                        )(...args);
                    } catch (e) {
                        if (e instanceof SandboxError) throw e;
                        if (e instanceof Error) {
                            throw new SandboxError("RuntimeError", e.message);
                        }
                        throw new SandboxError("RuntimeError", String(e));
                    }
                };
            }
            return wrapped;
        }
        const value = await runMontyAsyncWithPrint(m, {
            limits: {
                maxDurationSecs,
                maxMemory,
                maxAllocations: DEFAULT_MAX_ALLOCATIONS,
            },
            /**
             * Captures print output from the sandbox into the prints array.
             * Silently drops prints beyond MAX_PRINT_CAPTURE_BYTES — the Monty
             * runtime continues executing but we stop accumulating output.
             *
             * @param _stream - The output stream name (unused).
             * @param text - The printed text content.
             */
            printCallback: (_stream, text) => {
                const textBytes = Buffer.byteLength(text, "utf-8");
                if (printBytes + textBytes <= MAX_PRINT_CAPTURE_BYTES) {
                    prints.push(text);
                    printBytes += textBytes;
                }
            },
            externalFunctions: wrapForMonty({
                /**
                 * Signals that the LLM needs another execution round.
                 * Sets the continueThinkingCalled flag and returns null to Python.
                 *
                 * @returns Null.
                 */
                continue_thinking: () => {
                    continueThinkingCalled = true;
                    return null;
                },

                /**
                 * Peeks at BAM file headers and summary info.
                 *
                 * @param bamPath - Path to the BAM file.
                 * @param opts - Optional snake_case options from sandbox code.
                 * @returns The BAM file metadata including contigs and modifications.
                 */
                peek: async (
                    bamPath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    rejectTreatAsUrl(opts);
                    const resolved = await resolvePath(allowedDir, bamPath);
                    return peekFn({ bamPath: resolved });
                },

                /**
                 * Reads per-read alignment info from a BAM file.
                 *
                 * @param bamPath - Path to the BAM file.
                 * @param opts - Optional snake_case options from sandbox code.
                 * @returns An array of per-read alignment records.
                 */
                read_info: async (
                    bamPath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    rejectTreatAsUrl(opts);
                    const resolved = await resolvePath(allowedDir, bamPath);
                    const result = await readInfo(
                        toReadOptions(resolved, opts, maxRecordsReadInfo),
                    );
                    enforceRecordLimit(result, "read_info", maxRecordsReadInfo);
                    return result;
                },

                /**
                 * Reads base modification data from a BAM file.
                 *
                 * @param bamPath - Path to the BAM file.
                 * @param opts - Optional snake_case options from sandbox code.
                 * @returns An array of base modification records.
                 */
                bam_mods: async (
                    bamPath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    rejectTreatAsUrl(opts);
                    const resolved = await resolvePath(allowedDir, bamPath);
                    const result = await bamMods(
                        toReadOptions(resolved, opts, maxRecordsBamMods),
                    );
                    enforceRecordLimit(result, "bam_mods", maxRecordsBamMods);
                    return result;
                },

                /**
                 * Computes windowed read statistics from a BAM file.
                 *
                 * @param bamPath - Path to the BAM file.
                 * @param opts - Optional snake_case options from sandbox code.
                 * @returns The windowed statistics as a parsed JSON array.
                 */
                window_reads: async (
                    bamPath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    rejectTreatAsUrl(opts);
                    const resolved = await resolvePath(allowedDir, bamPath);
                    const json = await windowReads(
                        toWindowOptions(resolved, opts, maxRecordsWindowReads),
                    );
                    const parsed: unknown = JSON.parse(json);
                    if (!Array.isArray(parsed)) {
                        throw new SandboxError(
                            "RuntimeError",
                            "window_reads returned non-array JSON",
                        );
                    }
                    const records = parsed as unknown[];
                    enforceRecordLimit(
                        records,
                        "window_reads",
                        maxRecordsWindowReads,
                    );
                    return records;
                },

                /**
                 * Extracts per-read sequence table as TSV from a BAM file.
                 *
                 * @param bamPath - Path to the BAM file.
                 * @param opts - Optional snake_case options from sandbox code.
                 * @returns The sequence table as a TSV string.
                 */
                seq_table: async (
                    bamPath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    rejectTreatAsUrl(opts);
                    const resolved = await resolvePath(allowedDir, bamPath);
                    const tsv = await seqTable(
                        toReadOptions(resolved, opts, maxRecordsSeqTable),
                    );
                    return enforceDataSizeLimit(
                        tsv,
                        "seq_table",
                        maxOutputBytes,
                    );
                },

                /**
                 * Lists files in the allowed directory, with optional glob filtering.
                 *
                 * @param pattern - Optional glob pattern or options object.
                 * @returns A list of relative file paths, or an object with truncation info.
                 */
                ls: async (pattern?: string | Record<string, unknown>) => {
                    const patternStr =
                        typeof pattern === "string" ? pattern : undefined;
                    const matcher = patternStr
                        ? picomatch(patternStr)
                        : undefined;
                    const { files, capped } = await listFilesRecursive(
                        allowedDir,
                        allowedDir,
                        { pattern: matcher },
                    );
                    if (capped) {
                        return {
                            files,
                            _truncated: {
                                message:
                                    `Listing capped at ${MAX_LS_ENTRIES} entries. ` +
                                    "Use a glob pattern to narrow results (e.g. ls('**/*.bam')).",
                                cap: MAX_LS_ENTRIES,
                            },
                        };
                    }
                    return files;
                },

                /**
                 * Reads a text file from the allowed directory with optional offset and size limit.
                 *
                 * @param filePath - Path to the file to read.
                 * @param opts - Optional options with offset and max_bytes.
                 * @returns An object with content, bytes_read, total_size, and offset.
                 */
                read_file: async (
                    filePath: string,
                    opts?: Record<string, unknown>,
                ) => {
                    const resolved = await resolvePath(allowedDir, filePath);

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
                    const rawMaxBytes =
                        opts?.max_bytes ?? DEFAULT_MAX_READ_BYTES;
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
                    const requestedBytes = Math.min(
                        rawMaxBytes,
                        DEFAULT_MAX_READ_BYTES,
                    );
                    const fd = await open(resolved, "r");
                    try {
                        const stat = await fd.stat();
                        const totalSize = stat.size;
                        const buf = Buffer.alloc(requestedBytes);
                        const { bytesRead } = await fd.read(
                            buf,
                            0,
                            requestedBytes,
                            offset,
                        );
                        return {
                            content: buf.toString("utf-8", 0, bytesRead),
                            bytes_read: bytesRead,
                            total_size: totalSize,
                            offset,
                        };
                    } finally {
                        await fd.close();
                    }
                },

                /**
                 * Writes a text file to the ai_chat_output subdirectory (no overwrites).
                 *
                 * @param filePath - Path for the new file (relative to output dir).
                 * @param content - The text content to write.
                 * @returns An object with the written path and bytes_written.
                 */
                write_file: async (filePath: string, content: string) => {
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
                    if (contentBytes > DEFAULT_MAX_WRITE_BYTES) {
                        throw new SandboxError(
                            "ValueError",
                            `Content size ${contentBytes} bytes exceeds write limit of ` +
                                `${DEFAULT_MAX_WRITE_BYTES} bytes (${DEFAULT_MAX_WRITE_BYTES / 1024 / 1024} MB)`,
                        );
                    }
                    const outputDir = join(allowedDir, AI_CHAT_OUTPUT_DIR);
                    await mkdir(outputDir, { recursive: true });
                    // Validate the path stays inside outputDir before creating directories
                    const tentative = resolve(outputDir, filePath);
                    assertInside(
                        outputDir,
                        tentative,
                        `Path "${filePath}" is outside the allowed directory`,
                    );
                    const parentDir = join(tentative, "..");
                    await mkdir(parentDir, { recursive: true });
                    // Resolve against allowedDir (not outputDir) so a symlinked
                    // ai_chat_output directory cannot escape the sandbox root.
                    const resolved = await resolvePath(
                        allowedDir,
                        join(AI_CHAT_OUTPUT_DIR, filePath),
                    );
                    try {
                        await access(resolved);
                        throw new SandboxError(
                            "FileExistsError",
                            `File "${filePath}" already exists in ${AI_CHAT_OUTPUT_DIR}/. ` +
                                "Choose a different name.",
                        );
                    } catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                            throw e;
                    }
                    await writeFile(resolved, content, "utf-8");
                    return {
                        path: `${AI_CHAT_OUTPUT_DIR}/${filePath}`,
                        bytes_written: contentBytes,
                    };
                },
            }),
        });

        const converted = convertMaps(value);
        const { gated, truncated } = gateOutputSize(converted, maxOutputBytes);

        return {
            success: true,
            value: gated,
            truncated,
            endedWithExpression: converted != null,
            continueThinkingCalled,
            prints,
        };
    } catch (error) {
        // On error, continueThinkingCalled is discarded (not included) but
        // prints are preserved — they show how far execution got before the error.
        if (error instanceof MontyRuntimeError) {
            return {
                success: false,
                errorType: "RuntimeError",
                message: error.message,
                isTimeout: error.message.includes("time limit"),
                prints,
            };
        }
        if (error instanceof MontySyntaxError) {
            return {
                success: false,
                errorType: "SyntaxError",
                message: error.message,
                isTimeout: false,
                prints,
            };
        }
        return {
            success: false,
            errorType: "GenericError",
            message: String(error),
            isTimeout: false,
            prints,
        };
    }
}
