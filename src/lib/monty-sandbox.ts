// Monty sandbox wrapper for AI Chat mode.
// Encapsulates @pydantic/monty with @nanalogue/node external functions and security guards.

import { randomUUID } from "node:crypto";
import {
    type ExceptionInput,
    Monty,
    MontyComplete,
    MontyNameLookup,
    MontyRuntimeError,
    MontySyntaxError,
    type ResourceLimits,
} from "@pydantic/monty";
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
    MAX_LS_ENTRIES,
} from "./ai-chat-constants";
import {
    makeBamMods,
    makeBash,
    makeContinueThinking,
    makeLs,
    makePeek,
    makePlotHistogram,
    makePlotSeries,
    makeReadFile,
    makeReadInfo,
    makeRunMinimap2,
    makeSeqTable,
    makeWindowReads,
    makeWriteFile,
} from "./ai-external-tools";
import type { SandboxOptions, SandboxResult } from "./chat-types";
import {
    convertMaps,
    SandboxError,
    safeStringify,
} from "./monty-sandbox-helpers";

export {
    deriveMaxOutputBytes,
    rejectTreatAsUrl,
    resolvePath,
    safeStringify,
    toReadOptions,
    toWindowOptions,
} from "./monty-sandbox-helpers";

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
    if (result.success && result.endedWithExpression && result.value != null) {
        if (result.outputFile) {
            parts.push(`${result.value}\n`);
        } else {
            const valStr = safeStringify(result.value);
            parts.push(`${valStr.ok ? valStr.json : valStr.fallback}\n`);
        }
    }
    return parts.join("") || "(No output produced.)";
}

/**
 * Collects direct-execution output for display to the user.
 * Includes traceback text on failure so /exec users can see sandbox errors.
 *
 * @param result - The sandbox execution result.
 * @returns Terminal output on success, or prints plus error details on failure.
 */
export function collectDirectExecutionOutput(result: SandboxResult): string {
    if (result.success) {
        return collectTerminalOutput(result);
    }

    const parts: string[] = [...(result.prints ?? [])];
    parts.push(`${result.errorType}: ${result.message}`);
    return parts.join("") || "(Execution failed.)";
}

/**
 * Wraps external functions to convert plain JS Error to Monty-compatible SandboxError.
 * Monty only accepts specific Python exception type names (e.g. RuntimeError, ValueError).
 *
 * @param fns - Map of function names to their implementations.
 * @param onCall - Optional callback invoked with each called function name.
 * @returns A new map with each function wrapped in SandboxError conversion.
 */
export function wrapForMonty(
    fns: Record<string, (...args: never[]) => unknown>,
    onCall?: (name: string) => void,
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
            onCall?.(name);
            try {
                return await (fn as (...a: unknown[]) => Promise<unknown>)(
                    ...args,
                );
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

/** Options for {@link runMontyWithExternalFunctions}. */
export interface MontyExternalRunOptions {
    /** Monty resource limits. */
    limits: ResourceLimits;
    /** Receives each printed text chunk with its stream name. */
    printCallback: (stream: string, text: string) => void;
    /** Host functions callable from Python, keyed by Python name. */
    externalFunctions: Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Drives a Monty program to completion, answering external-function calls.
 *
 * Replaces `runMontyAsync` from `@pydantic/monty` 0.0.18, whose loop resumes the
 * snapshot inside the same `try` as the external call. Any Python exception
 * raised after the first external call (including MemoryError and the
 * TimeoutError from the time limit) therefore reached its `catch` as a
 * MontyRuntimeError and was re-raised into Python with the invalid type name
 * "MontyRuntimeError", replacing the real traceback with
 * "Invalid exception type: 'MontyRuntimeError'". Here only the external call is
 * guarded, so `resume()` errors propagate as the original MontyRuntimeError.
 *
 * @param monty - The parsed Monty program.
 * @param options - Resource limits, print callback, and external functions.
 * @returns The program's final value.
 */
export async function runMontyWithExternalFunctions(
    monty: Monty,
    options: MontyExternalRunOptions,
): Promise<unknown> {
    const { limits, printCallback, externalFunctions } = options;
    let progress = monty.start({ limits, printCallback });
    while (!(progress instanceof MontyComplete)) {
        if (progress instanceof MontyNameLookup) {
            const fn = Object.hasOwn(externalFunctions, progress.variableName)
                ? externalFunctions[progress.variableName]
                : undefined;
            progress = fn ? progress.resume({ value: fn }) : progress.resume();
            continue;
        }
        const snapshot = progress;
        const fn = Object.hasOwn(externalFunctions, snapshot.functionName)
            ? externalFunctions[snapshot.functionName]
            : undefined;
        if (!fn) {
            progress = snapshot.resume({
                exception: {
                    type: "NameError",
                    message: `name '${snapshot.functionName}' is not defined`,
                },
            });
            continue;
        }
        let returnValue: unknown;
        let exception: ExceptionInput | undefined;
        try {
            returnValue = await fn(...snapshot.args, snapshot.kwargs);
        } catch (error) {
            exception =
                error instanceof SandboxError
                    ? { type: error.name, message: error.message }
                    : { type: "RuntimeError", message: String(error) };
        }
        // Outside the try: a Python error raised while resuming must reach
        // runSandboxCode as the MontyRuntimeError Monty threw.
        progress = exception
            ? snapshot.resume({ exception })
            : snapshot.resume({ returnValue });
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
        maxAllocations = DEFAULT_MAX_ALLOCATIONS,
        maxRecordsReadInfo = DEFAULT_MAX_RECORDS_READ_INFO,
        maxRecordsBamMods = DEFAULT_MAX_RECORDS_BAM_MODS,
        maxRecordsWindowReads = DEFAULT_MAX_RECORDS_WINDOW_READS,
        maxRecordsSeqTable = DEFAULT_MAX_RECORDS_SEQ_TABLE,
        maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
        maxReadBytes = DEFAULT_MAX_READ_BYTES,
        maxWriteBytes = DEFAULT_MAX_WRITE_BYTES,
        maxLsEntries = MAX_LS_ENTRIES,
        removedTools,
    } = options;

    let continueThinkingCalled = false;
    let sandboxToolCalled = false;
    const prints: string[] = [];
    let printBytes = 0;
    let printsExceededLimit = false;
    let result: SandboxResult;

    // Wall-clock abort for bash: fires after maxDurationSecs and cancels any
    // in-flight bash command via AbortSignal. Other external functions (native
    // Rust calls) cannot be interrupted mid-flight and are not affected.
    const bashAbortController = new AbortController();
    let bashTimedOut = false;
    const bashTimer = setTimeout(() => {
        bashTimedOut = true;
        bashAbortController.abort();
    }, maxDurationSecs * 1000);

    try {
        const m = new Monty(code);

        const value = await runMontyWithExternalFunctions(m, {
            limits: {
                maxDurationSecs,
                maxMemory,
                maxAllocations,
            },
            /**
             * Captures complete prints up to the shared output-file ceiling.
             * Above it, discards the partial capture and reports OutputError
             * after execution finishes; no partial output is delivered.
             *
             * @param _stream - The output stream name (unused).
             * @param text - The printed text content.
             */
            printCallback: (_stream, text) => {
                if (printsExceededLimit || !text) return;
                const textBytes = Buffer.byteLength(text, "utf-8");
                printBytes += textBytes;
                if (printBytes <= DEFAULT_MAX_WRITE_BYTES) {
                    prints.push(text);
                } else {
                    prints.length = 0;
                    printsExceededLimit = true;
                }
            },
            externalFunctions: wrapForMonty(
                // Build all implementations, then drop any the caller removed.
                Object.fromEntries(
                    Object.entries({
                        continue_thinking: makeContinueThinking(() => {
                            continueThinkingCalled = true;
                        }),
                        bash: makeBash(allowedDir, {
                            signal: bashAbortController.signal,
                            maxMemory,
                            maxAllocations,
                            maxReadBytes,
                        }),
                        peek: makePeek(allowedDir),
                        read_info: makeReadInfo(allowedDir, maxRecordsReadInfo),
                        bam_mods: makeBamMods(allowedDir, maxRecordsBamMods),
                        window_reads: makeWindowReads(
                            allowedDir,
                            maxRecordsWindowReads,
                        ),
                        seq_table: makeSeqTable(allowedDir, maxRecordsSeqTable),
                        ls: makeLs(allowedDir, maxLsEntries),
                        read_file: makeReadFile(allowedDir, maxReadBytes),
                        write_file: makeWriteFile(allowedDir, maxWriteBytes),
                        plot_histogram: makePlotHistogram(
                            allowedDir,
                            maxWriteBytes,
                        ),
                        plot_series: makePlotSeries(allowedDir, maxWriteBytes),
                        minimap2: makeRunMinimap2(allowedDir),
                    }).filter(([name]) => !removedTools?.has(name)),
                ) as Record<string, (...args: never[]) => unknown>,
                (name) => {
                    if (name !== "continue_thinking") {
                        sandboxToolCalled = true;
                    }
                },
            ),
        });

        // If the bash abort timer fired while Python was catching the abort
        // error (try/except), execution may still complete successfully.
        // Treat this as a timeout rather than letting a partial result through.
        if (bashTimedOut) {
            throw new SandboxError("RuntimeError", "execution aborted");
        }
        if (printsExceededLimit) {
            throw new SandboxError(
                "OutputError",
                "Printed output exceeded the file limit.",
            );
        }

        const converted = convertMaps(value);
        let deliveredValue = converted;
        let outputFile: string | undefined;
        if (converted != null) {
            const serialized = safeStringify(converted);
            if (!serialized.ok) {
                throw new SandboxError(
                    "OutputError",
                    "Python execution completed, but its returned output could not be serialized. " +
                        "The result was not saved or returned. Any files written during execution remain.",
                );
            }
            const outputBytes = Buffer.byteLength(serialized.json, "utf-8");
            if (outputBytes > DEFAULT_MAX_WRITE_BYTES) {
                throw new SandboxError(
                    "OutputError",
                    `Python execution completed, but its returned output (${outputBytes} bytes) exceeded the ` +
                        `${DEFAULT_MAX_WRITE_BYTES / 1024 / 1024} MiB limit. The result was not saved or returned. ` +
                        "Any files written during execution remain. Rerun with code that returns a smaller summary.",
                );
            }
            if (outputBytes > maxOutputBytes) {
                if (
                    typeof converted !== "string" &&
                    typeof converted !== "object"
                ) {
                    throw new SandboxError(
                        "OutputError",
                        "Python execution completed, but its returned output exceeded the inline limit. " +
                            "Only strings, lists, and dictionaries can be saved as overflow files. " +
                            "The result was not saved or returned. Any files written during execution remain.",
                    );
                }
                const outputType = Array.isArray(converted)
                    ? "array (list)"
                    : typeof converted === "string"
                      ? "string"
                      : "object (dictionary)";
                outputFile = `${AI_CHAT_OUTPUT_DIR}/python-result-${randomUUID()}.json`;
                try {
                    await makeWriteFile(allowedDir, DEFAULT_MAX_WRITE_BYTES)(
                        outputFile,
                        serialized.json,
                    );
                } catch (error) {
                    throw new SandboxError(
                        "OutputError",
                        "Python execution completed, but saving its returned output failed: " +
                            `${String(error)}. Any files written during execution remain.`,
                    );
                }
                const readHint =
                    outputBytes <= maxReadBytes
                        ? `Import json, then read it with json.loads(read_file("${outputFile}")["content"]).`
                        : `The file exceeds read_file's ${maxReadBytes}-byte per-call limit. ` +
                          "Do not json.loads a partial read_file result. Return a smaller summary, " +
                          "or ask the user to increase the configured read limit before loading the full JSON file.";
                deliveredValue =
                    "Python execution completed. The result exceeded the inline limit. " +
                    `Full output saved to ${outputFile} (${outputBytes} bytes). ` +
                    "The file contains the complete returned value, with no wrapper or execution metadata. " +
                    `Top-level JSON type: ${outputType}. ` +
                    readHint;
            }
        }

        result = {
            success: true,
            value: deliveredValue,
            truncated: false,
            ...(outputFile && { outputFile }),
            endedWithExpression: converted != null,
            continueThinkingCalled,
            sandboxToolCalled,
            prints,
        };
    } catch (error) {
        // On error, continueThinkingCalled is discarded (not included) but
        // prints are preserved — they show how far execution got before the error.
        if (error instanceof MontyRuntimeError) {
            result = {
                success: false,
                errorType: "RuntimeError",
                message: error.display("traceback"),
                isTimeout: bashTimedOut || error.message.includes("time limit"),
                prints,
            };
        } else if (error instanceof MontySyntaxError) {
            result = {
                success: false,
                errorType: "SyntaxError",
                message: error.message,
                isTimeout: false,
                prints,
            };
        } else {
            result = {
                success: false,
                errorType:
                    error instanceof SandboxError ? error.name : "GenericError",
                message:
                    error instanceof SandboxError
                        ? error.message
                        : String(error),
                isTimeout: bashTimedOut,
                prints,
            };
        }
    } finally {
        // Always clear the bash abort timer so it does not fire after
        // execution has already completed (success or error).
        clearTimeout(bashTimer);
    }

    if (printsExceededLimit) {
        return {
            success: false,
            errorType: "OutputError",
            message:
                "Python execution finished, but its printed output exceeded the " +
                `${DEFAULT_MAX_WRITE_BYTES / 1024 / 1024} MiB limit. Printed output was not saved or returned. ` +
                "Any files written during execution remain. Rerun with code that prints a smaller summary.",
            isTimeout: result.success ? false : result.isTimeout,
            prints: [],
        };
    }

    // Keep a complete inline value or file notice; move the whole printed text
    // to a file when it cannot share the inline allowance with that value.
    const printBudget =
        result.success && result.endedWithExpression
            ? Math.max(
                  0,
                  maxOutputBytes -
                      Buffer.byteLength(JSON.stringify(result.value), "utf-8"),
              )
            : maxOutputBytes;
    if (printBytes > printBudget) {
        const text = prints.join("");
        prints.length = 0;
        const path = `${AI_CHAT_OUTPUT_DIR}/python-prints-${randomUUID()}.txt`;
        try {
            await makeWriteFile(allowedDir, DEFAULT_MAX_WRITE_BYTES)(
                path,
                text,
            );
            const readHint =
                printBytes <= maxReadBytes
                    ? `Read the text with read_file("${path}")["content"].`
                    : `The file exceeds read_file's ${maxReadBytes}-byte per-call limit. ` +
                      "Return a smaller summary, or ask the user to increase the configured read limit before loading the full text file.";
            prints.push(
                `Full printed output saved to ${path} (${printBytes} bytes). ` +
                    "The file contains the complete printed text as UTF-8, not JSON. " +
                    readHint +
                    "\n",
            );
        } catch (error) {
            return {
                success: false,
                errorType: "OutputError",
                message:
                    `Python execution finished, but saving its printed output failed: ${String(error)}. ` +
                    "Printed output was not saved or returned. Any files written during execution remain.",
                isTimeout: result.success ? false : result.isTimeout,
                prints: [],
            };
        }
    }
    return result;
}
