// Sandbox execution and feedback helpers for AI chat orchestration.
// Keeps execution retries, output shaping, and code extraction separate.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    FEEDBACK_OUTPUT_MAX_BYTES,
    TERMINAL_OUTPUT_OVERFLOW_BYTES,
} from "./ai-chat-constants";
import type { SandboxOptions, SandboxResult } from "./chat-types";
import { runSandboxCode } from "./monty-sandbox";
import {
    resolvePath,
    safeStringify,
    safeUtf8Slice,
} from "./monty-sandbox-helpers";

/** Module-scoped flag tracking whether a sandbox execution is in flight. */
let sandboxRunning = false;

/**
 * Runs sandbox code with orphan execution cap (at most one orphaned execution at a time).
 *
 * @param code - The Python code to execute.
 * @param allowedDir - The allowed directory for file operations.
 * @param options - Sandbox configuration options.
 * @param signal - Optional abort signal to cancel while waiting for the lock.
 * @returns A SandboxResult with the execution outcome.
 */
export async function runSandboxGuarded(
    code: string,
    allowedDir: string,
    options: SandboxOptions,
    signal?: AbortSignal,
): Promise<SandboxResult> {
    while (sandboxRunning) {
        if (signal?.aborted) {
            throw (
                signal.reason ??
                new DOMException("The operation was aborted.", "AbortError")
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (signal?.aborted) {
        throw (
            signal.reason ??
            new DOMException("The operation was aborted.", "AbortError")
        );
    }
    sandboxRunning = true;
    // Post-lock abort check: closes the race window between the last poll
    // iteration and lock acquisition so no sandbox work starts after abort.
    if (signal?.aborted) {
        sandboxRunning = false;
        throw (
            signal.reason ??
            new DOMException("The operation was aborted.", "AbortError")
        );
    }
    try {
        return await runSandboxCode(code, allowedDir, options);
    } finally {
        sandboxRunning = false;
    }
}

/**
 * Regex matching ```python, ```Python, ```py, and bare ``` fences (case-insensitive).
 *  Uses \s+ (not \s*\n) to also match inline fences where the code follows a space.
 */
const FENCE_PATTERN = /```(?:python|py)?\s+([\s\S]*?)```/gi;

/**
 * Extracts Python code from markdown fences in an LLM response.
 * Multiple code blocks are concatenated with double newlines.
 * Returns null if no fences are found.
 *
 * @param response - The raw LLM response text.
 * @returns The extracted code, or null if no fences found.
 */
export function extractCodeFromFences(response: string): string | null {
    const matches = [...response.matchAll(FENCE_PATTERN)];
    if (matches.length === 0) return null;
    return matches.map((m) => m[1].trimEnd()).join("\n\n");
}

/**
 * Handles overflow for terminal output: if > TERMINAL_OUTPUT_OVERFLOW_BYTES,
 * writes full output to a file and returns a pointer message.
 *
 * @param text - The terminal output text.
 * @param allowedDir - The allowed directory for file operations.
 * @returns The output text or an overflow pointer message.
 */
export async function handleTerminalOverflow(
    text: string,
    allowedDir: string,
): Promise<string> {
    const outputBytes = Buffer.byteLength(text, "utf-8");
    if (outputBytes > TERMINAL_OUTPUT_OVERFLOW_BYTES) {
        try {
            const outputDir = join(allowedDir, "ai_chat_output");
            await mkdir(outputDir, { recursive: true });
            // Resolve through symlinks and verify we're still inside allowedDir.
            // resolvePath throws if the resolved path escapes the sandbox root.
            const safeDir = await resolvePath(allowedDir, "ai_chat_output");
            const filename = `${randomUUID()}.txt`;
            const outputFile = join(safeDir, filename);
            await writeFile(outputFile, text, "utf-8");
            return `Output too large (${outputBytes} bytes). Full output saved to ai_chat_output/${filename} in the allowed directory.`;
        } catch {
            return `Output too large (${outputBytes} bytes) but could not write to file (path validation failed).`;
        }
    }
    return text;
}

/**
 * Truncates a prints string to fit within a byte budget.
 *
 * @param prints - The prints string to truncate.
 * @param maxBytes - The maximum byte budget.
 * @returns The truncated string and whether truncation occurred.
 */
function truncatePrints(
    prints: string,
    maxBytes: number,
): {
    /** The truncated text. */
    text: string;
    /** Whether truncation occurred. */
    truncated: boolean;
} {
    const bytes = Buffer.byteLength(prints, "utf-8");
    if (bytes <= maxBytes) return { text: prints, truncated: false };
    return {
        text: `${safeUtf8Slice(prints, maxBytes)}\n...(truncated)`,
        truncated: true,
    };
}

/**
 * Builds a JSON execution result message for feeding back to the LLM.
 * Includes rounds_remaining so the LLM can budget its analysis.
 *
 * @param result - The sandbox execution result.
 * @param roundsRemaining - The number of execution rounds remaining.
 * @returns The formatted feedback string.
 */
export function buildExecutionFeedback(
    result: SandboxResult,
    roundsRemaining: number,
): string {
    if (result.success) {
        const feedback: Record<string, unknown> = { success: true };
        if (result.prints?.length) {
            const joined = result.prints.join("");
            const { text, truncated } = truncatePrints(
                joined,
                FEEDBACK_OUTPUT_MAX_BYTES,
            );
            feedback.prints = text;
            // Mark truncated if truncatePrints clipped the joined text, OR if
            // runSandboxCode already clipped it via the maxPrintBytes ceiling
            // (result.printsTruncated). Without this, a small-context-window
            // run where maxPrintBytes == FEEDBACK_OUTPUT_MAX_BYTES would pass
            // the already-clipped text through truncatePrints with no trim and
            // silently drop the truncation signal.
            if (truncated || result.printsTruncated) feedback.truncated = true;
        }
        if (result.endedWithExpression && result.value != null) {
            const valStr = safeStringify(result.value);
            const serialized = valStr.ok ? valStr.json : valStr.fallback;
            // Compute remaining byte budget after prints and JSON overhead (~200 bytes)
            const printsBytes = feedback.prints
                ? Buffer.byteLength(String(feedback.prints), "utf-8")
                : 0;
            const overhead = 200;
            const valueBudget =
                FEEDBACK_OUTPUT_MAX_BYTES - printsBytes - overhead;
            const serializedBytes = Buffer.byteLength(serialized, "utf-8");
            if (serializedBytes > valueBudget) {
                feedback.value = `${safeUtf8Slice(serialized, Math.max(0, valueBudget))}\n...(truncated)`;
                feedback.value_truncated = true;
            } else {
                // Round-trip through JSON.parse to ensure the value is safe for
                // the outer JSON.stringify.
                feedback.value = valStr.ok
                    ? JSON.parse(valStr.json)
                    : valStr.fallback;
                // gateOutputSize may have already truncated the value (e.g. a
                // large array or string); surface that to the LLM even if the
                // truncated representation fits within the feedback byte budget.
                if (result.truncated) feedback.value_truncated = true;
            }
        }
        feedback.rounds_remaining = roundsRemaining;
        return `Code execution result: ${JSON.stringify(feedback)}`;
    }
    const errorPayload: Record<string, unknown> = {
        success: false,
        error_type: result.errorType,
        message: result.message,
        is_timeout: result.isTimeout ?? false,
        ...(result.isTimeout && {
            timeout_note: "The sandbox execution time limit was reached.",
        }),
        rounds_remaining: roundsRemaining,
    };
    if (result.prints?.length) {
        const joined = result.prints.join("");
        const { text, truncated } = truncatePrints(
            joined,
            FEEDBACK_OUTPUT_MAX_BYTES,
        );
        errorPayload.prints = text;
        // Mirror the success-path logic: also flag truncation when runSandboxCode
        // clipped prints via the maxPrintBytes ceiling before truncatePrints ran.
        if (truncated || result.printsTruncated) errorPayload.truncated = true;
    }
    // Include instructive hint inside the JSON on SyntaxError so the model
    // learns the expected format.
    if (result.errorType === "SyntaxError") {
        errorPayload.hint =
            "Your response was not valid Python. You must respond with Python code only — " +
            "no markdown, no prose, no explanation. " +
            "Use # comments for thinking. " +
            'If you want to talk directly to the user, use print("") — ' +
            "you can use arbitrarily long strings. " +
            "Use print() for this, not continue_thinking() and not print(continue_thinking(...)) etc.";
    }
    return `Code execution result: ${JSON.stringify(errorPayload)}`;
}
