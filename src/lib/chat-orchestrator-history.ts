// History and context helpers for AI chat orchestration.
// Keeps token budgeting, failed-round pruning, and LLM message conversion separate.

import { NOMINAL_BYTES_PER_TOKEN } from "./ai-chat-constants";
import type { HistoryEntry } from "./chat-types";

/**
 * Estimates token count from plain text using a bytes-per-token heuristic.
 *
 * @param text - The text to estimate.
 * @param bytesPerToken - Estimated bytes per token for this provider/model.
 * @returns Approximate token count.
 */
function estimateTokens(
    text: string,
    bytesPerToken = NOMINAL_BYTES_PER_TOKEN,
): number {
    return Math.max(
        1,
        Math.ceil(Buffer.byteLength(text, "utf-8") / bytesPerToken),
    );
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
 * Applies a sliding window to keep messages within the given token budget.
 * Keeps the most recent messages, dropping older ones first.
 *
 * @param history - The pruned history to window.
 * @param budgetTokens - The available history budget in tokens.
 * @param bytesPerToken - Estimated bytes per token for this provider/model.
 * @returns A windowed history array.
 */
export function applySlidingWindow(
    history: HistoryEntry[],
    budgetTokens: number,
    bytesPerToken = NOMINAL_BYTES_PER_TOKEN,
): HistoryEntry[] {
    if (budgetTokens <= 0) {
        return history.length > 0 ? [history[history.length - 1]] : [];
    }
    if (history.length === 0) return [];

    // Always retain the newest message so the LLM always sees the latest user prompt,
    // even if a single oversized message exceeds the budget on its own.
    let totalTokens = estimateTokens(
        history[history.length - 1].content,
        bytesPerToken,
    );
    const result: HistoryEntry[] = [history[history.length - 1]];

    for (let i = history.length - 2; i >= 0; i--) {
        const tokens = estimateTokens(history[i].content, bytesPerToken);
        if (totalTokens + tokens > budgetTokens) break;
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
 * @param config.contextBudgetTokens - The available history budget in tokens.
 * @param config.bytesPerToken - Estimated bytes per token for this provider/model.
 * @returns Transformed history ready for phase 2.
 */
export function transformContext(
    history: HistoryEntry[],
    config: {
        /** The total context budget in tokens. */
        contextBudgetTokens: number;
        /** Estimated bytes per token for this provider/model. */
        bytesPerToken?: number;
    },
): HistoryEntry[] {
    const pruned = pruneFailedRounds(history);
    return applySlidingWindow(
        pruned,
        config.contextBudgetTokens,
        config.bytesPerToken,
    );
}

/**
 * Derives the history-only token budget after reserving space for the system
 * prompt and the model's completion.
 *
 * @param contextWindowTokens - The model context window in tokens.
 * @param systemPrompt - The system prompt sent with every request.
 * @param completionTokens - Tokens reserved for the model's completion.
 * @param bytesPerToken - Estimated bytes per token for this provider/model.
 * @returns Remaining token budget available for conversation history.
 */
export function deriveHistoryBudgetTokens(
    contextWindowTokens: number,
    systemPrompt: string,
    completionTokens: number,
    bytesPerToken = NOMINAL_BYTES_PER_TOKEN,
): number {
    return Math.max(
        1,
        contextWindowTokens -
            estimateTokens(systemPrompt, bytesPerToken) -
            completionTokens,
    );
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
