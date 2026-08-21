// Provider-specific adjustments for OpenAI-compatible chat completion payloads.
// Keeps endpoint and model compatibility rules out of the LLM transport.

/** Request payload sent to an OpenAI-compatible chat completions endpoint. */
export interface ChatCompletionPayload {
    /** The model identifier. */
    model: string;
    /** The conversation messages, including the system prompt. */
    messages: Array<{
        /** The message role. */
        role: string;
        /** The message content. */
        content: string;
    }>;
    /** The modern OpenAI completion-token limit field. */
    max_completion_tokens?: number;
    /** The legacy OpenAI completion-token limit field. */
    max_tokens?: number;
    /** Optional sampling temperature. */
    temperature?: number;
    /** Optional reasoning level for providers that support it. */
    reasoning_effort?: "medium";
}

/**
 * Returns a chat completion payload adjusted for known provider differences.
 *
 * @param payload - The provider-neutral chat completion payload.
 * @param endpointUrl - The LLM endpoint URL used for provider detection.
 * @returns A new payload containing any required provider-specific fields.
 */
export function adjustChatCompletionPayloadForProvider(
    payload: ChatCompletionPayload,
    endpointUrl: string,
): ChatCompletionPayload {
    const adjustedPayload = { ...payload };
    const endpointUrlObject = new URL(endpointUrl);
    const endpointHostname = endpointUrlObject.hostname;
    const endpointPort = endpointUrlObject.port;

    // TODO: This Ollama heuristic breaks if users run Ollama on a
    // non-11434 port; replace it with real provider detection later.
    const usesLegacyMaxTokensField =
        endpointHostname === "mistral.ai" ||
        endpointHostname.endsWith(".mistral.ai") ||
        endpointHostname === "chutes.ai" ||
        endpointHostname.endsWith(".chutes.ai") ||
        endpointHostname === "ollama.com" ||
        ((endpointHostname === "localhost" ||
            endpointHostname === "127.0.0.1") &&
            endpointPort === "11434");
    if (usesLegacyMaxTokensField) {
        adjustedPayload.max_tokens = adjustedPayload.max_completion_tokens;
        delete adjustedPayload.max_completion_tokens;
    }

    // Gemini 3.1 Pro defaults to high reasoning, which can consume the entire
    // completion budget before producing executable code. Google's
    // OpenAI-compatible API maps medium reasoning effort to the model's medium
    // thinking level, leaving room for the visible response.
    if (
        endpointHostname === "generativelanguage.googleapis.com" &&
        payload.model.startsWith("gemini-3.1-pro")
    ) {
        adjustedPayload.reasoning_effort = "medium";
    }

    return adjustedPayload;
}
