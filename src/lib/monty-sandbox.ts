// Monty sandbox wrapper for AI Chat mode.
// Encapsulates @pydantic/monty with @nanalogue/node external functions and security guards.

import {
    Monty,
    MontyRuntimeError,
    MontySnapshot,
    MontySyntaxError,
} from "@pydantic/monty";
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
    MAX_PRINT_CAPTURE_BYTES,
} from "./ai-chat-constants";
import {
    makeBamMods,
    makeContinueThinking,
    makeLs,
    makePeek,
    makeReadFile,
    makeReadInfo,
    makeSeqTable,
    makeWindowReads,
    makeWriteFile,
} from "./ai-external-tools";
import type { SandboxOptions, SandboxResult } from "./chat-types";
import {
    convertMaps,
    gateOutputSize,
    SandboxError,
    safeStringify,
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
        removedTools,
    } = options;

    let continueThinkingCalled = false;
    const prints: string[] = [];
    let printBytes = 0;
    let printsTruncated = false;

    try {
        const m = new Monty(code, {
            externalFunctions: removedTools
                ? EXTERNAL_FUNCTIONS.filter((n) => !removedTools.has(n))
                : [...EXTERNAL_FUNCTIONS],
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
            externalFunctions: wrapForMonty(
                // Build all implementations, then drop any the caller removed.
                Object.fromEntries(
                    Object.entries({
                        continue_thinking: makeContinueThinking(() => {
                            continueThinkingCalled = true;
                        }),
                        peek: makePeek(allowedDir),
                        read_info: makeReadInfo(allowedDir, maxRecordsReadInfo),
                        bam_mods: makeBamMods(allowedDir, maxRecordsBamMods),
                        window_reads: makeWindowReads(
                            allowedDir,
                            maxRecordsWindowReads,
                        ),
                        seq_table: makeSeqTable(
                            allowedDir,
                            maxRecordsSeqTable,
                            maxOutputBytes,
                        ),
                        ls: makeLs(allowedDir),
                        read_file: makeReadFile(allowedDir, maxReadBytes),
                        write_file: makeWriteFile(allowedDir, maxWriteBytes),
                    }).filter(([name]) => !removedTools?.has(name)),
                ) as Record<string, (...args: never[]) => unknown>,
            ),
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
