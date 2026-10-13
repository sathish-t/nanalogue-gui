// History and context helpers for AI chat orchestration.
// Keeps token budgeting, sliding-window limits, and LLM message conversion separate.

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
 * Applies a sliding window to keep messages within the given token budget.
 * Keeps the most recent messages, dropping older ones first.
 *
 * @param history - The complete conversation history to window.
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
 * Applies the context sliding window without removing failed execution rounds.
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
    return applySlidingWindow(
        history,
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
 * Strips the internal isExecutionResult marker, which is not sent to the LLM.
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
