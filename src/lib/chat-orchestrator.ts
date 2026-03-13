// Chat orchestrator for AI Chat mode.
// Manages conversation history, context transformation, facts, and the code-only LLM loop.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
    BYTES_PER_TOKEN,
    CONFIG_FIELD_SPECS,
    CONTEXT_BUDGET_FRACTION,
    DEFAULT_MAX_CODE_ROUNDS,
    FEEDBACK_OUTPUT_MAX_BYTES,
    MAX_CUMULATIVE_SANDBOX_MS,
    MAX_FACTS_BYTES,
    TERMINAL_OUTPUT_OVERFLOW_BYTES,
} from "./ai-chat-constants";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
    SandboxOptions,
    SandboxResult,
} from "./chat-types";
import { generateChatHtml } from "./log-to-html.js";
import { collectTerminalOutput, runSandboxCode } from "./monty-sandbox";
import {
    deriveMaxOutputBytes,
    resolvePath,
    safeStringify,
    safeUtf8Slice,
} from "./monty-sandbox-helpers";
import {
    buildSandboxPrompt,
    buildSystemPrompt,
    renderFactsBlock,
} from "./sandbox-prompt";

/** A single message in the LLM request payload (system, user, or assistant). */
export interface LlmMessage {
    /** The message role. */
    role: string;
    /** The message content. */
    content: string;
}

/** Most recent messages array sent (or attempted) to the LLM API. */
let lastSentMessages: LlmMessage[] | null = null;

/**
 * Clears the stored last-sent messages. Called by ChatSession.reset().
 */
export function resetLastSentMessages(): void {
    lastSentMessages = null;
}

/**
 * Returns the stored last-sent messages for the /dump_llm_instructions command.
 *
 * @returns The last-sent messages array, or null if no LLM call has been attempted.
 */
export function getLastSentMessages(): LlmMessage[] | null {
    return lastSentMessages;
}

/**
 * Replaces the stored last-sent messages. Used by tests to seed dump state.
 *
 * @param messages - The messages to store, or null to clear.
 */
export function setLastSentMessages(messages: LlmMessage[] | null): void {
    lastSentMessages = messages;
}

/**
 * Paths produced by a successful dumpLlmInstructions call, both relative to
 * the allowedDir sandbox root.
 */
export interface DumpLlmInstructionsResult {
    /** Relative path to the plain-text .log file. */
    log: string;
    /** Relative path to the self-contained .html file. */
    html: string;
}

/**
 * Writes the last LLM request payload to a dated log file and a sibling HTML
 * file in ai_chat_output/ inside the given directory. Used by both the
 * /dump_llm_instructions slash command and the --dump-llm-instructions CLI
 * flag.
 *
 * @param allowedDir - The analysis directory (must be the sandbox root).
 * @returns Paths to both output files relative to allowedDir, or null if no
 *   LLM call has been made yet.
 */
export async function dumpLlmInstructions(
    allowedDir: string,
): Promise<DumpLlmInstructionsResult | null> {
    if (!lastSentMessages) return null;
    /* Snapshot the messages immediately, before any await, so that both the
       .log and .html outputs always describe the same conversation even if
       another chat turn updates lastSentMessages while we are writing. */
    const messages = lastSentMessages;

    const outputDir = join(allowedDir, "ai_chat_output");
    await mkdir(outputDir, { recursive: true });
    const safeDir = await resolvePath(allowedDir, "ai_chat_output");

    const date = new Date().toISOString().slice(0, 10);
    const uuid = randomUUID();
    const stem = `nanalogue-chat-${date}-${uuid}`;
    const logFile = join(safeDir, `${stem}.log`);
    const htmlFile = join(safeDir, `${stem}.html`);

    const logContent = messages
        .map(
            (msg, i) =>
                `=== Message ${i + 1}: ${msg.role} ===\n\n${msg.content}`,
        )
        .join("\n\n");
    await writeFile(logFile, logContent, "utf-8");

    const htmlContent = generateChatHtml(messages, uuid);
    await writeFile(htmlFile, htmlContent, "utf-8");

    return {
        log: relative(allowedDir, logFile),
        html: relative(allowedDir, htmlFile),
    };
}

/**
 * Removes failed code-execute-feedback round pairs from history,
 * keeping the most recent failed pair so the model can see its last error.
 * A failed round is an assistant message (code) followed by a user message
 * with executionStatus: "error". Each pair is evaluated independently.
 *
 * @param history - The conversation history to prune.
 * @returns A new history array with old failed round pairs removed.
 */
export function pruneFailedRounds(history: HistoryEntry[]): HistoryEntry[] {
    // First pass: identify all failed-pair indices
    const failedPairStarts: number[] = [];
    for (let i = 0; i < history.length - 1; i++) {
        const entry = history[i];
        if (entry.role === "assistant") {
            const next = history[i + 1];
            if (next.role === "user" && next.executionStatus === "error") {
                failedPairStarts.push(i);
            }
        }
    }
    // Keep the last failed pair so the model can see its most recent error
    const skipIndices = new Set<number>();
    for (let j = 0; j < failedPairStarts.length - 1; j++) {
        skipIndices.add(failedPairStarts[j]);
        skipIndices.add(failedPairStarts[j] + 1);
    }
    const result: HistoryEntry[] = [];
    for (let i = 0; i < history.length; i++) {
        if (!skipIndices.has(i)) {
            result.push(history[i]);
        }
    }
    return result;
}

/**
 * Estimates token count from a history entry using a rough 4 bytes per token heuristic.
 *
 * @param entry - The history entry to estimate.
 * @returns Approximate token count.
 */
function estimateTokens(entry: HistoryEntry): number {
    return Math.ceil(
        Buffer.byteLength(entry.content, "utf-8") / BYTES_PER_TOKEN,
    );
}

/**
 * Applies a sliding window to keep messages within ~80% of the context budget.
 * Keeps the most recent messages, dropping older ones first.
 *
 * @param history - The pruned history to window.
 * @param budgetTokens - The total context budget in tokens.
 * @returns A windowed history array.
 */
export function applySlidingWindow(
    history: HistoryEntry[],
    budgetTokens: number,
): HistoryEntry[] {
    const budget = Math.floor(budgetTokens * CONTEXT_BUDGET_FRACTION);
    if (history.length === 0) return [];

    // Always retain the newest message so the LLM always sees the latest user prompt,
    // even if a single oversized message exceeds the budget on its own.
    let totalTokens = estimateTokens(history[history.length - 1]);
    const result: HistoryEntry[] = [history[history.length - 1]];

    for (let i = history.length - 2; i >= 0; i--) {
        const tokens = estimateTokens(history[i]);
        if (totalTokens + tokens > budget) break;
        totalTokens += tokens;
        result.unshift(history[i]);
    }

    return result;
}

/**
 * Phase 1 of the context pipeline: prune failed rounds then apply sliding window.
 *
 * @param history - The full conversation history.
 * @param config - Context configuration with budget.
 * @param config.contextBudgetTokens - The total context budget in tokens.
 * @returns Transformed history ready for phase 2.
 */
export function transformContext(
    history: HistoryEntry[],
    config: {
        /** The total context budget in tokens. */
        contextBudgetTokens: number;
    },
): HistoryEntry[] {
    const pruned = pruneFailedRounds(history);
    return applySlidingWindow(pruned, config.contextBudgetTokens);
}

/**
 * Converts internal history to LLM message format.
 * Strips internal metadata (isExecutionResult, executionStatus) — these are
 * used for context management and renderer display, not sent to the LLM.
 *
 * @param history - The transformed history from phase 1.
 * @returns Clean message array for the LLM API.
 */
export function convertToLlmMessages(history: HistoryEntry[]): Array<{
    /** The role: "user", "assistant", or "system". */
    role: string;
    /** The text content of the message sent to the LLM. */
    content: string;
}> {
    return history.map((entry) => ({
        role: entry.role,
        content: entry.content,
    }));
}

/**
 * Adds a new fact to the facts array with replace-by-key dedup.
 *
 * @param facts - The current facts array (mutated in place).
 * @param newFact - The fact to add.
 */
export function addFact(facts: Fact[], newFact: Fact): void {
    /**
     * Derives a unique dedup key from a fact based on its type.
     *
     * @param f - The fact to derive a key from.
     * @returns A string key unique to the fact's identity.
     */
    const keyOf = (f: Fact): string => {
        switch (f.type) {
            case "file":
                return `file:${f.filename}`;
            case "filter":
                return `filter:${f.roundId}`;
            case "output":
                return `output:${f.path}`;
        }
    };

    const newKey = keyOf(newFact);
    const existingIdx = facts.findIndex((f) => keyOf(f) === newKey);
    if (existingIdx >= 0) {
        facts[existingIdx] = newFact;
    } else {
        facts.push(newFact);
    }
}

/**
 * Evicts oldest filter facts when the array exceeds MAX_FACTS_BYTES.
 * Output facts are never age-evicted.
 *
 * @param facts - The facts array to evict from (mutated in place).
 */
export function evictFacts(facts: Fact[]): void {
    const serialized = safeStringify(facts);
    const currentBytes = serialized.ok
        ? Buffer.byteLength(serialized.json, "utf-8")
        : 0;

    if (currentBytes <= MAX_FACTS_BYTES) return;

    // Evict filter facts first (oldest first), then file facts if still over budget.
    // Output facts are never evicted.
    const evictable = facts
        .map((f, i) => ({ fact: f, index: i }))
        .filter((e) => e.fact.type === "filter" || e.fact.type === "file")
        .sort((a, b) => {
            // Filters before files, then oldest first within each type
            if (a.fact.type !== b.fact.type) {
                return a.fact.type === "filter" ? -1 : 1;
            }
            return a.fact.timestamp - b.fact.timestamp;
        });

    for (const entry of evictable) {
        facts.splice(facts.indexOf(entry.fact), 1);
        const recheck = safeStringify(facts);
        const recheckBytes = recheck.ok
            ? Buffer.byteLength(recheck.json, "utf-8")
            : 0;
        if (recheckBytes <= MAX_FACTS_BYTES) break;
    }
}

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
 * Extracts facts from a successful execution result and the code that produced it.
 *
 * @param toolResult - The sandbox result.
 * @param toolCallArgs - The parsed code arguments.
 * @param toolCallArgs.code - The Python code that was executed.
 * @param roundId - The execution round identifier.
 * @param facts - The facts array to add to (mutated in place).
 */
export function extractFacts(
    toolResult: SandboxResult,
    toolCallArgs: { /** The Python code that was executed. */ code: string },
    roundId: string,
    facts: Fact[],
): void {
    if (!toolResult.success) return;

    const now = Date.now();
    const code = toolCallArgs.code;

    // Extract file facts from peek/read_info/bam_mods calls
    const fileMatches = code.matchAll(
        /(?:peek|read_info|bam_mods|window_reads|seq_table)\s*\(\s*["']([^"']+)["']/g,
    );
    for (const match of fileMatches) {
        addFact(facts, {
            type: "file",
            filename: match[1],
            roundId,
            timestamp: now,
        });
    }

    // Extract output facts from write_file calls
    if (
        toolResult.value &&
        typeof toolResult.value === "object" &&
        "path" in (toolResult.value as Record<string, unknown>)
    ) {
        const writeResult = toolResult.value as Record<string, unknown>;
        const path = writeResult.path;
        const bytesWritten = writeResult.bytes_written;
        const hasWriteFileCall = /write_file\s*\(/.test(code);
        if (
            hasWriteFileCall &&
            typeof path === "string" &&
            path &&
            typeof bytesWritten === "number"
        ) {
            addFact(facts, {
                type: "output",
                path,
                roundId,
                timestamp: now,
            });
        }
    }

    // Extract filter facts from kwargs
    const filterParts: string[] = [];
    const regionMatch = code.match(/region\s*=\s*["']([^"']+)["']/);
    if (regionMatch) filterParts.push(`region=${regionMatch[1]}`);
    const sampleMatch = code.match(/sample_fraction\s*=\s*([\d.]+)/);
    if (sampleMatch) filterParts.push(`sample_fraction=${sampleMatch[1]}`);
    const mapqMatch = code.match(/mapq_filter\s*=\s*(\d+)/);
    if (mapqMatch) filterParts.push(`mapq>=${mapqMatch[1]}`);
    if (filterParts.length > 0) {
        addFact(facts, {
            type: "filter",
            description: filterParts.join(", "),
            roundId,
            timestamp: now,
        });
    }

    evictFacts(facts);
}

/** Response from the /chat/completions endpoint. */
interface ChatCompletionResponse {
    /** The response choices array. */
    choices: Array<{
        /** The assistant message. */
        message: {
            /** The message role. */
            role: string;
            /** The message content. */
            content: string | null;
        };
        /** The reason generation stopped. */
        finish_reason: string;
    }>;
}

/** Retryable HTTP status codes. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Sleeps for the given duration, rejecting immediately if the signal is aborted.
 * Cleans up the abort listener when the timer fires normally.
 *
 * @param ms - The number of milliseconds to sleep.
 * @param signal - The abort signal to listen for.
 * @returns A promise that resolves after the delay or rejects on abort.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        /**
         * Cleans up the timer and rejects on abort.
         */
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Calls the /chat/completions endpoint with retry logic.
 * Temperature is only included when explicitly set (not undefined).
 *
 * @param endpointUrl - The LLM endpoint URL.
 * @param apiKey - The API key (may be empty).
 * @param model - The model identifier.
 * @param systemPrompt - The system prompt.
 * @param messages - The conversation messages.
 * @param maxRetries - Maximum number of retry attempts.
 * @param signal - Abort signal for cancellation.
 * @param temperature - Optional sampling temperature.
 * @returns The parsed completion response.
 */
async function fetchChatCompletion(
    endpointUrl: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    messages: Array<{
        /** The message role. */
        role: string;
        /** The message content. */
        content: string;
    }>,
    maxRetries: number,
    signal: AbortSignal,
    temperature?: number,
): Promise<ChatCompletionResponse> {
    const base = endpointUrl.endsWith("/") ? endpointUrl : `${endpointUrl}/`;
    const url = new URL("chat/completions", base).href;
    // Mistral and chutes.ai use the older max_tokens field; all other
    // OpenAI-compatible providers use max_completion_tokens. Sending both
    // causes errors on providers that validate for unknown fields, so we
    // pick one based on the endpoint URL — same approach as pi-mono's
    // openai-completions provider.
    const maxTokensField =
        endpointUrl.includes("mistral.ai") || endpointUrl.includes("chutes.ai")
            ? "max_tokens"
            : "max_completion_tokens";
    const payload: Record<string, unknown> = {
        model,
        [maxTokensField]: 4096,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
    };
    // Only include temperature when explicitly set — omitting lets the
    // provider choose its own default, which is the safest universal behavior.
    if (temperature !== undefined) {
        payload.temperature = temperature;
    }
    const body = JSON.stringify(payload);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                body,
                signal,
            });
            if (!response.ok) {
                if (
                    RETRYABLE_STATUS_CODES.has(response.status) &&
                    attempt < maxRetries
                ) {
                    let delay = Math.min(1000 * 2 ** attempt, 30000);
                    if (response.status === 429) {
                        const retryAfter = response.headers.get("Retry-After");
                        if (retryAfter && Number.isFinite(Number(retryAfter))) {
                            delay = Number(retryAfter) * 1000;
                        }
                    }
                    await abortableSleep(delay, signal);
                    continue;
                }
                let errorMsg = `HTTP ${response.status}: ${await response.text()}`;
                if (response.status === 404) {
                    errorMsg +=
                        "\nIf you're using Ollama, make sure your endpoint URL ends with /v1 (e.g., http://localhost:11434/v1).";
                }
                throw new Error(errorMsg);
            }
            return (await response.json()) as ChatCompletionResponse;
        } catch (e) {
            if (signal.aborted) throw e;
            // Non-retryable HTTP errors are thrown with "HTTP " prefix — re-throw immediately
            if (e instanceof Error && e.message.startsWith("HTTP ")) throw e;
            // Malformed JSON from a 200 response — not retryable
            if (e instanceof SyntaxError) throw e;
            // Network errors (no response received) are retryable
            lastError = e instanceof Error ? e : new Error(String(e));
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * 2 ** attempt, 30000);
                await abortableSleep(delay, signal);
            }
        }
    }
    throw lastError ?? new Error("All retries exhausted");
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
async function handleTerminalOverflow(
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
            const relPath = relative(allowedDir, outputFile);
            return `Output too large (${outputBytes} bytes). Written to ${relPath}`;
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
function buildExecutionFeedback(
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
            "Your response was not valid Python. You must respond with Python code only — no markdown, no prose, no explanation. Use # comments for thinking.";
    }
    return `Code execution result: ${JSON.stringify(errorPayload)}`;
}

/** Options for the handleUserMessage orchestration function. */
export interface HandleMessageOptions {
    /** The user's message text. */
    message: string;
    /** The endpoint URL. */
    endpointUrl: string;
    /** The API key (may be empty). */
    apiKey: string;
    /** The model name. */
    model: string;
    /** The allowed directory for BAM files. */
    allowedDir: string;
    /** The orchestrator configuration. */
    config: AiChatConfig;
    /** Callback for emitting events to the renderer. */
    emitEvent: (event: AiChatEvent) => void;
    /** The conversation history (mutated in place). */
    history: HistoryEntry[];
    /** The facts array (mutated in place). */
    facts: Fact[];
    /** AbortSignal for cancellation. */
    signal: AbortSignal;
    /**
     * Optional text to append to the default system prompt, loaded from
     * SYSTEM_APPEND.md in the analysis directory. When present, it is
     * inserted between the sandbox prompt and the dynamic facts block.
     */
    appendSystemPrompt?: string;
    /**
     * Optional text to replace the default system prompt entirely. When
     * provided, buildSandboxPrompt() is not used; this text becomes the base
     * instead. AppendSystemPrompt and the dynamic facts block still stack on
     * top in the usual order. CLI-only feature.
     */
    replaceSystemPrompt?: string;
    /**
     * Optional set of tool names to omit from the Monty sandbox. Each name
     * must be a member of EXTERNAL_FUNCTIONS. CLI-only feature.
     */
    removedTools?: ReadonlySet<string>;
}

/**
 * Handles a user message: builds context, calls the LLM, runs sandbox code, returns response.
 * This is the main orchestration entry point called by the IPC handler.
 *
 * @param options - The message handling options.
 * @returns The assistant's text response and steps for the code panel.
 */
export async function handleUserMessage(
    options: HandleMessageOptions,
): Promise<{
    /** The assistant's final text response. */
    text: string;
    /** The list of sandbox execution steps with code and results. */
    steps: Array<{
        /** The Python code that was executed. */
        code: string;
        /** The sandbox execution result. */
        result: SandboxResult;
    }>;
}> {
    const {
        message,
        endpointUrl,
        apiKey,
        model,
        allowedDir,
        config,
        emitEvent,
        history,
        facts,
        signal,
        appendSystemPrompt,
        replaceSystemPrompt,
        removedTools,
    } = options;

    // Add user message to history
    history.push({ role: "user", content: message });

    // Handle /exec slash command — run a user file directly, skip the LLM.
    const execMatch = message.match(/^\/exec\s+(.+)$/);
    if (execMatch) {
        history.pop();
        const maxOutputBytes = deriveMaxOutputBytes(config.contextWindowTokens);
        emitEvent({ type: "turn_start" });
        const filePath = execMatch[1].trim();
        if (!filePath.endsWith(".py")) {
            throw new Error("/exec only supports .py files");
        }
        const resolved = await resolvePath(allowedDir, filePath);
        const code = await readFile(resolved, "utf-8");

        emitEvent({ type: "code_execution_start", code });
        const sandboxResult = await runSandboxGuarded(
            code,
            allowedDir,
            {
                maxRecordsReadInfo: config.maxRecordsReadInfo,
                maxRecordsBamMods: config.maxRecordsBamMods,
                maxRecordsWindowReads: config.maxRecordsWindowReads,
                maxRecordsSeqTable: config.maxRecordsSeqTable,
                maxOutputBytes,
                maxDurationSecs: config.maxDurationSecs,
                maxMemory: config.maxMemoryMB * 1024 * 1024,
                maxAllocations: config.maxAllocations,
                maxReadBytes: config.maxReadMB * 1024 * 1024,
                maxWriteBytes: config.maxWriteMB * 1024 * 1024,
                removedTools,
            },
            signal,
        );
        emitEvent({ type: "code_execution_end", result: sandboxResult });

        const text =
            "# Direct user execution\n" +
            "# These results do not go to the LLM, so do not reference any of these results in your LLM conversation.\n" +
            "# Any text overflow etc. are the user's responsibility.\n" +
            "# Timeouts may not apply to you (check the package's code if you want to know more).\n\n" +
            collectTerminalOutput(sandboxResult);
        const steps = [{ code, result: sandboxResult }];
        emitEvent({ type: "turn_end", text, steps });
        return { text, steps };
    }

    // Handle /dump_llm_instructions — dump last LLM request payload to file.
    const dumpMatch = message.match(/^\/dump_llm_instructions\s*$/);
    if (dumpMatch) {
        history.pop();
        emitEvent({ type: "turn_start" });

        const dump = await dumpLlmInstructions(allowedDir);
        const text = dump
            ? `LLM instructions dumped to ${dump.log}\n` +
              `HTML view: ${dump.html}\n` +
              "These files are not fed back to the LLM. Do not reference them in conversations."
            : "No LLM call has been made yet, nothing to dump.";
        emitEvent({ type: "turn_end", text, steps: [] });
        return { text, steps: [] };
    }

    // Handle /dump_system_prompt — dump the static system prompt to file.
    const dumpSysPromptMatch = message.match(/^\/dump_system_prompt\s*$/);
    if (dumpSysPromptMatch) {
        history.pop();
        emitEvent({ type: "turn_start" });

        const outputDir = join(allowedDir, "ai_chat_output");
        await mkdir(outputDir, { recursive: true });
        const safeDir = await resolvePath(allowedDir, "ai_chat_output");

        const date = new Date().toISOString().slice(0, 10);
        const uuid = randomUUID();
        const filename = `nanalogue-chat-${date}-${uuid}.log`;
        const outputFile = join(safeDir, filename);

        const maxOutputBytesForPrompt = deriveMaxOutputBytes(
            config.contextWindowTokens,
        );
        const maxOutputKBForPrompt = Math.round(maxOutputBytesForPrompt / 1024);
        // When --system-prompt (replaceSystemPrompt) is active, use it as the
        // base; otherwise build the default sandbox prompt. appendSystemPrompt
        // (SYSTEM_APPEND.md) stacks on top of whichever base is active.
        const basePromptForDump =
            replaceSystemPrompt ??
            buildSandboxPrompt({
                maxOutputKB: maxOutputKBForPrompt,
                maxRecordsReadInfo: config.maxRecordsReadInfo,
                maxRecordsBamMods: config.maxRecordsBamMods,
                maxRecordsWindowReads: config.maxRecordsWindowReads,
                maxRecordsSeqTable: config.maxRecordsSeqTable,
                maxReadMB: config.maxReadMB,
                maxWriteMB: config.maxWriteMB,
                maxDurationSecs: config.maxDurationSecs,
            });
        // Include SYSTEM_APPEND.md content in the dump so it accurately
        // reflects the full system prompt that is sent to the LLM.
        const promptContent = appendSystemPrompt
            ? `${basePromptForDump}\n\n${appendSystemPrompt}`
            : basePromptForDump;
        await writeFile(outputFile, promptContent, "utf-8");

        const relPath = relative(allowedDir, outputFile);
        const text =
            `System prompt dumped to ${relPath}\n` +
            "This message is not fed back to the LLM. Do not reference this file in conversations.";
        emitEvent({ type: "turn_end", text, steps: [] });
        return { text, steps: [] };
    }

    // Build system prompt
    const maxOutputBytes = deriveMaxOutputBytes(config.contextWindowTokens);
    const maxOutputKB = Math.round(maxOutputBytes / 1024);
    // When --system-prompt (replaceSystemPrompt) is active, use it as the
    // base instead of the built-in sandbox prompt. appendSystemPrompt
    // (SYSTEM_APPEND.md) and the dynamic facts block still stack on top of
    // whichever base is active, in the usual order.
    //
    // Note: the context-window budget (maxOutputBytes) is derived from
    // contextWindowTokens without subtracting the system prompt size — this
    // is a pre-existing approximation that also applies to the large sandbox
    // prompt itself. SYSTEM_APPEND.md is intended for small domain context
    // (a few paragraphs); very large files will reduce usable context just
    // as any enlarged system prompt would.
    const basePrompt =
        replaceSystemPrompt ??
        buildSandboxPrompt({
            maxOutputKB,
            maxRecordsReadInfo: config.maxRecordsReadInfo,
            maxRecordsBamMods: config.maxRecordsBamMods,
            maxRecordsWindowReads: config.maxRecordsWindowReads,
            maxRecordsSeqTable: config.maxRecordsSeqTable,
            maxReadMB: config.maxReadMB,
            maxWriteMB: config.maxWriteMB,
            maxDurationSecs: config.maxDurationSecs,
        });
    const effectiveSandboxPrompt = appendSystemPrompt
        ? `${basePrompt}\n\n${appendSystemPrompt}`
        : basePrompt;
    const factsBlock = renderFactsBlock(facts);
    const systemPrompt = buildSystemPrompt(effectiveSandboxPrompt, factsBlock);

    // Sandbox options
    const sandboxOptions: SandboxOptions = {
        maxRecordsReadInfo: config.maxRecordsReadInfo,
        maxRecordsBamMods: config.maxRecordsBamMods,
        maxRecordsWindowReads: config.maxRecordsWindowReads,
        maxRecordsSeqTable: config.maxRecordsSeqTable,
        maxOutputBytes,
        maxDurationSecs: config.maxDurationSecs,
        maxMemory: config.maxMemoryMB * 1024 * 1024,
        maxAllocations: config.maxAllocations,
        maxReadBytes: config.maxReadMB * 1024 * 1024,
        maxWriteBytes: config.maxWriteMB * 1024 * 1024,
        // maxPrintBytes is intentionally left at its default (MAX_PRINT_CAPTURE_BYTES,
        // 1 MB) so that large print()-based final answers are fully captured and
        // can be redirected to an overflow file by handleTerminalOverflow.
        // The LLM-facing truncation at the context budget is already enforced
        // downstream by truncatePrints() in buildExecutionFeedback.
        removedTools,
    };

    const steps: Array<{
        /** The Python code. */
        code: string;
        /** The result. */
        result: SandboxResult;
    }> = [];
    let cumulativeSandboxMs = 0;
    const maxRounds = config.maxCodeRounds ?? DEFAULT_MAX_CODE_ROUNDS;

    // Combine abort signals
    const timeoutMs =
        (config.timeoutSeconds ?? CONFIG_FIELD_SPECS.timeoutSeconds.fallback) *
        1000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

    emitEvent({ type: "turn_start" });

    let finalText = "";

    let round = 0;
    for (; round < maxRounds; round++) {
        // Short-circuit before calling the LLM when sandbox budget is exhausted.
        // The post-loop forced-final path sends a nudge and does one final LLM call.
        if (cumulativeSandboxMs >= MAX_CUMULATIVE_SANDBOX_MS) break;

        // Prepare context
        const prepared = transformContext(history, {
            contextBudgetTokens: config.contextWindowTokens,
        });
        const llmMessages = convertToLlmMessages(prepared);

        // Store the request payload before the call so it's available
        // even if the LLM call fails (network error, 4xx, etc.)
        lastSentMessages = [
            { role: "system", content: systemPrompt },
            ...llmMessages,
        ];

        // Call LLM
        emitEvent({ type: "llm_request_start" });
        const completion = await fetchChatCompletion(
            endpointUrl,
            apiKey,
            model,
            systemPrompt,
            llmMessages,
            config.maxRetries,
            combinedSignal,
            config.temperature,
        );
        emitEvent({ type: "llm_request_end" });

        const rawCode = completion.choices?.[0]?.message?.content ?? "";

        // Append the assistant response now that we have it
        lastSentMessages = [
            ...lastSentMessages,
            { role: "assistant", content: rawCode },
        ];
        if (!rawCode.trim()) break;

        // Check finish_reason — "length" means response was truncated by token limit
        const finishReason = completion.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
            history.push({ role: "assistant", content: rawCode });
            const truncMsg =
                "Code execution result: " +
                JSON.stringify({
                    success: false,
                    error_type: "TruncatedResponse",
                    message:
                        "Your response was truncated (output token limit reached). Please write shorter code or split your analysis into smaller steps using continue_thinking().",
                    rounds_remaining: maxRounds - (round + 1),
                });
            history.push({
                role: "user",
                content: truncMsg,
                isExecutionResult: true,
                executionStatus: "error",
            });
            continue;
        }

        // Execute code. On SyntaxError, try markdown fence extraction.
        let code = rawCode;
        emitEvent({ type: "code_execution_start", code });
        const startTime = Date.now();
        let sandboxResult: SandboxResult;
        sandboxResult = await runSandboxGuarded(
            code,
            allowedDir,
            sandboxOptions,
            combinedSignal,
        );
        if (
            !sandboxResult.success &&
            sandboxResult.errorType === "SyntaxError"
        ) {
            const extracted = extractCodeFromFences(rawCode);
            if (extracted && extracted !== rawCode) {
                code = extracted;
                sandboxResult = await runSandboxGuarded(
                    code,
                    allowedDir,
                    sandboxOptions,
                    combinedSignal,
                );
            }
        }
        cumulativeSandboxMs += Date.now() - startTime;

        // Save the actually-executed code as assistant message
        history.push({ role: "assistant", content: code });
        emitEvent({ type: "code_execution_end", result: sandboxResult });

        steps.push({ code, result: sandboxResult });
        const roundId = `round-${randomUUID().slice(0, 8)}`;
        const roundsRemaining = maxRounds - (round + 1);

        if (sandboxResult.success) {
            extractFacts(sandboxResult, { code }, roundId, facts);

            if (sandboxResult.continueThinkingCalled) {
                // Non-terminal: feed structured result back to LLM
                const feedback = buildExecutionFeedback(
                    sandboxResult,
                    roundsRemaining,
                );
                history.push({
                    role: "user",
                    content: feedback,
                    isExecutionResult: true,
                    executionStatus: "ok",
                });
            } else {
                // Terminal (default): collect print output + final expression for user
                const hasOutput =
                    (sandboxResult.prints?.length ?? 0) > 0 ||
                    (sandboxResult.endedWithExpression &&
                        sandboxResult.value != null);
                if (!hasOutput) {
                    // No output produced — feed error back so the LLM can retry
                    const noOutputMsg =
                        "Code execution result: " +
                        JSON.stringify({
                            success: true,
                            no_output: true,
                            hint: "Your code produced no output. Use print() to show results to the user.",
                            rounds_remaining: roundsRemaining,
                        });
                    history.push({
                        role: "user",
                        content: noOutputMsg,
                        isExecutionResult: true,
                        executionStatus: "error",
                    });
                } else {
                    finalText = collectTerminalOutput(sandboxResult);
                    finalText = await handleTerminalOverflow(
                        finalText,
                        allowedDir,
                    );
                    // Persist execution feedback so follow-up turns have structured context
                    history.push({
                        role: "user",
                        content: buildExecutionFeedback(
                            sandboxResult,
                            maxRounds - (round + 1),
                        ),
                        isExecutionResult: true,
                        executionStatus: "ok",
                    });
                    // Store the user-facing answer as an assistant message so
                    // follow-up turns can see what was shown to the user.
                    history.push({
                        role: "assistant",
                        content: finalText,
                    });
                    break;
                }
            }
        } else {
            // Error: feed structured error back to LLM
            const feedback = buildExecutionFeedback(
                sandboxResult,
                roundsRemaining,
            );
            history.push({
                role: "user",
                content: feedback,
                isExecutionResult: true,
                executionStatus: "error",
            });
        }
    }

    // If maxRounds or sandbox budget exhausted without terminal response, do one final nudged round
    const budgetExhausted = cumulativeSandboxMs >= MAX_CUMULATIVE_SANDBOX_MS;
    if (!finalText && (round >= maxRounds || budgetExhausted)) {
        const exhaustedMsg = budgetExhausted
            ? "Maximum cumulative sandbox runtime exceeded. Please provide your final answer now (do not call continue_thinking())."
            : "You have reached the maximum number of code execution rounds. Please provide your final answer now (do not call continue_thinking()).";
        history.push({
            role: "user",
            content: exhaustedMsg,
            isExecutionResult: true,
            executionStatus: "error",
        });

        const prepared = transformContext(history, {
            contextBudgetTokens: config.contextWindowTokens,
        });
        const llmMessages = convertToLlmMessages(prepared);

        // Store the request payload before the call so it's available
        // even if the LLM call fails (network error, 4xx, etc.)
        lastSentMessages = [
            { role: "system", content: systemPrompt },
            ...llmMessages,
        ];

        emitEvent({ type: "llm_request_start" });
        const completion = await fetchChatCompletion(
            endpointUrl,
            apiKey,
            model,
            systemPrompt,
            llmMessages,
            config.maxRetries,
            combinedSignal,
            config.temperature,
        );
        emitEvent({ type: "llm_request_end" });

        const rawFinal = completion.choices?.[0]?.message?.content ?? "";

        // Append the assistant response now that we have it
        lastSentMessages = [
            ...lastSentMessages,
            { role: "assistant", content: rawFinal },
        ];
        const finalFinishReason = completion.choices?.[0]?.finish_reason;
        if (finalFinishReason === "length") {
            // Truncated forced-final response — do not execute partial code.
            // Push the truncated content as assistant message for context,
            // then fall through to the fallback message.
            history.push({ role: "assistant", content: rawFinal });
        } else if (
            rawFinal.trim() &&
            cumulativeSandboxMs >= MAX_CUMULATIVE_SANDBOX_MS
        ) {
            // Sandbox budget exhausted — push raw response without executing
            finalText =
                "(Sandbox execution budget exhausted. The model's response could not be executed.)";
            history.push({ role: "assistant", content: finalText });
        } else if (rawFinal.trim()) {
            // Apply markdown fence extraction (same as main loop SyntaxError path)
            let codeToRun = rawFinal;
            emitEvent({ type: "code_execution_start", code: codeToRun });
            let result = await runSandboxGuarded(
                codeToRun,
                allowedDir,
                sandboxOptions,
                combinedSignal,
            );
            if (!result.success && result.errorType === "SyntaxError") {
                const extracted = extractCodeFromFences(rawFinal);
                if (extracted && extracted !== rawFinal) {
                    codeToRun = extracted;
                    result = await runSandboxGuarded(
                        codeToRun,
                        allowedDir,
                        sandboxOptions,
                        combinedSignal,
                    );
                }
            }
            history.push({ role: "assistant", content: codeToRun });
            emitEvent({ type: "code_execution_end", result });
            steps.push({ code: codeToRun, result });
            // Forced round: ignore continueThinkingCalled — always treat as terminal
            if (result.success) {
                extractFacts(
                    result,
                    { code: codeToRun },
                    "forced-final",
                    facts,
                );
                finalText = collectTerminalOutput(result);
                finalText = await handleTerminalOverflow(finalText, allowedDir);
            }
            // Record execution feedback for follow-up turn context
            history.push({
                role: "user",
                content: buildExecutionFeedback(result, 0),
                isExecutionResult: true,
                executionStatus: result.success ? "ok" : "error",
            });
            if (finalText) {
                history.push({
                    role: "assistant",
                    content: finalText,
                });
            }
        }
    }

    // Fallback if the model did not produce a terminal response
    if (!finalText) {
        finalText =
            "(The model did not produce a usable response. Its output may have been truncated or contained errors.)";
    }

    emitEvent({ type: "turn_end", text: finalText, steps });
    return { text: finalText, steps };
}
