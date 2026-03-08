// Monty sandbox wrapper for AI Chat mode.
// Encapsulates @pydantic/monty with @nanalogue/node external functions and security guards.

import { access, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
    MAX_PRINT_CAPTURE_BYTES,
} from "./ai-chat-constants";
import type { SandboxOptions, SandboxResult } from "./chat-types";
import {
    assertExistingAncestorInside,
    assertInside,
    convertMaps,
    enforceDataSizeLimit,
    enforceRecordLimit,
    gateOutputSize,
    hasControlChars,
    isDeniedPath,
    listFilesRecursive,
    rejectTreatAsUrl,
    resolvePath,
    SandboxError,
    safeStringify,
    toForwardSlashes,
    toReadOptions,
    toWindowOptions,
} from "./monty-sandbox-helpers";

export {
    deriveMaxOutputBytes,
    gateOutputSize,
    rejectTreatAsUrl,
    resolvePath,
    safeStringify,
    toReadOptions,
    toWindowOptions,
} from "./monty-sandbox-helpers";

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
 * Collects all terminal output from a sandbox result into a single string.
 * Joins any print statements and, if the final expression produced a value,
 * appends its JSON representation. Returns "(No output produced.)" when empty.
 *
 * @param result - The sandbox execution result.
 * @returns The combined terminal output string.
 */
export function collectTerminalOutput(result: SandboxResult): string {
    const parts: string[] = [...(result.prints ?? [])];
    if (result.endedWithExpression && result.value != null) {
        const valStr = safeStringify(result.value);
        parts.push(`${valStr.ok ? valStr.json : valStr.fallback}\n`);
    }
    return parts.join("") || "(No output produced.)";
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
        maxAllocations = DEFAULT_MAX_ALLOCATIONS,
        maxRecordsReadInfo = DEFAULT_MAX_RECORDS_READ_INFO,
        maxRecordsBamMods = DEFAULT_MAX_RECORDS_BAM_MODS,
        maxRecordsWindowReads = DEFAULT_MAX_RECORDS_WINDOW_READS,
        maxRecordsSeqTable = DEFAULT_MAX_RECORDS_SEQ_TABLE,
        maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
        maxReadBytes = DEFAULT_MAX_READ_BYTES,
        maxWriteBytes = DEFAULT_MAX_WRITE_BYTES,
        maxPrintBytes = MAX_PRINT_CAPTURE_BYTES,
    } = options;

    let continueThinkingCalled = false;
    const prints: string[] = [];
    let printBytes = 0;
    let printsTruncated = false;

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
                maxAllocations,
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
                if (printBytes >= maxPrintBytes) {
                    // Subsequent chunks after the limit is reached are also truncated.
                    printsTruncated = true;
                    return;
                }
                const remaining = maxPrintBytes - printBytes;
                if (textBytes <= remaining) {
                    prints.push(text);
                    printBytes += textBytes;
                } else {
                    // Keep the leading bytes that still fit, backing off to a
                    // UTF-8 boundary so no multi-byte character is split.
                    const buf = Buffer.from(text);
                    let end = remaining;
                    while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
                    prints.push(buf.subarray(0, end).toString("utf-8"));
                    printBytes = maxPrintBytes;
                    printsTruncated = true;
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
                    // Resolve allowedDir to its real path so that
                    // relative(allowedDir, resolved) inside listFilesRecursive
                    // always yields a clean subpath even when allowedDir itself
                    // contains symlinks (resolved is always a real path).
                    const allowedDirReal = await realpath(allowedDir);
                    const { files, capped } = await listFilesRecursive(
                        allowedDirReal,
                        allowedDirReal,
                        { pattern: matcher, deny: isDeniedPath },
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
                    // Use the real path of allowedDir as the base so that
                    // relative() produces a clean subpath even when allowedDir
                    // itself contains symlinks (resolved is always a real path).
                    // Normalise to forward slashes so the picomatch patterns
                    // match correctly on Windows.
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
                 * Writes a text file to the allowed directory (no overwrites).
                 *
                 * @param filePath - Path for the new file (relative to the allowed directory).
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
                        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                            throw e;
                    }
                    await writeFile(resolved, content, "utf-8");
                    return {
                        path: filePath,
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
            printsTruncated,
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
                printsTruncated,
            };
        }
        if (error instanceof MontySyntaxError) {
            return {
                success: false,
                errorType: "SyntaxError",
                message: error.message,
                isTimeout: false,
                prints,
                printsTruncated,
            };
        }
        return {
            success: false,
            errorType: "GenericError",
            message: String(error),
            isTimeout: false,
            prints,
            printsTruncated,
        };
    }
}
