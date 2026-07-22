// LLM transport helpers for AI chat orchestration.
// Keeps API retries and prompt-token calibration separate from the main turn loop.

import { DEFAULT_MAX_COMPLETION_TOKENS } from "./ai-chat-constants";

/** Response from the /chat/completions endpoint. */
export interface ChatCompletionResponse {
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
    /** Optional usage block returned by many OpenAI-compatible providers. */
    usage?: {
        /** Tokens counted in the prompt. */
        prompt_tokens?: number;
        /** Tokens counted in the completion. */
        completion_tokens?: number;
        /** Total tokens counted for the request. */
        total_tokens?: number;
    };
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
export async function fetchChatCompletion(
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
        [maxTokensField]: DEFAULT_MAX_COMPLETION_TOKENS,
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
 * Derives a calibrated bytes-per-token estimate from a real API prompt token count.
 *
 * @param systemPrompt - The system prompt sent with the request.
 * @param messages - The non-system messages sent with the request.
 * @param promptTokens - The real prompt token count reported by the provider.
 * @returns A calibrated bytes-per-token estimate, or null if unavailable.
 */
export function deriveEstimatedBytesPerToken(
    systemPrompt: string,
    messages: Array<{
        /** The message role. */
        role: string;
        /** The message content. */
        content: string;
    }>,
    promptTokens: number | undefined,
): number | null {
    if (promptTokens === undefined || promptTokens <= 0) return null;
    const totalPromptBytes =
        Buffer.byteLength(systemPrompt, "utf-8") +
        messages.reduce(
            (total, message) =>
                total + Buffer.byteLength(message.content, "utf-8"),
            0,
        );
    if (totalPromptBytes <= 0) return null;
    return totalPromptBytes / promptTokens;
}
