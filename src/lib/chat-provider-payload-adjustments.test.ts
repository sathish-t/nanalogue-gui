// Tests for provider-specific chat completion payload adjustments.
// Verifies endpoint and model compatibility without exercising HTTP transport.

import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_COMPLETION_TOKENS } from "./ai-chat-constants";
import {
    adjustChatCompletionPayloadForProvider,
    type ChatCompletionPayload,
} from "./chat-provider-payload-adjustments";

/** A provider-neutral payload used by provider adjustment tests. */
const BASE_PAYLOAD: ChatCompletionPayload = {
    model: "test-model",
    max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
    messages: [{ role: "user", content: "hello" }],
};

describe("adjustChatCompletionPayloadForProvider", () => {
    it.each([
        "https://api.mistral.ai/v1",
        "https://chutes.ai/api/v1",
        "https://ollama.com/v1",
        "http://localhost:11434/v1",
        "http://127.0.0.1:11434/v1",
    ])("uses max_tokens for %s", (endpointUrl) => {
        const adjustedPayload = adjustChatCompletionPayloadForProvider(
            BASE_PAYLOAD,
            endpointUrl,
        );

        expect(adjustedPayload.max_tokens).toBe(DEFAULT_MAX_COMPLETION_TOKENS);
        expect(adjustedPayload.max_completion_tokens).toBeUndefined();
    });

    it("uses medium reasoning effort for Gemini 3.1 Pro", () => {
        const adjustedPayload = adjustChatCompletionPayloadForProvider(
            { ...BASE_PAYLOAD, model: "gemini-3.1-pro-preview" },
            "https://generativelanguage.googleapis.com/v1beta",
        );

        expect(adjustedPayload.reasoning_effort).toBe("medium");
        expect(adjustedPayload.max_completion_tokens).toBe(
            DEFAULT_MAX_COMPLETION_TOKENS,
        );
    });

    it("leaves generic OpenAI-compatible payloads unchanged", () => {
        const adjustedPayload = adjustChatCompletionPayloadForProvider(
            BASE_PAYLOAD,
            "https://api.openai.com/v1",
        );

        expect(adjustedPayload).toEqual(BASE_PAYLOAD);
        expect(adjustedPayload).not.toBe(BASE_PAYLOAD);
    });

    it.each([
        "https://notmistral.ai/v1",
        "https://notchutes.ai/v1",
        "https://example.com/providers/mistral.ai/v1",
        "https://example.com/providers/chutes.ai/v1",
    ])("does not infer a provider from non-hostname text in %s", (endpointUrl) => {
        const adjustedPayload = adjustChatCompletionPayloadForProvider(
            BASE_PAYLOAD,
            endpointUrl,
        );

        expect(adjustedPayload.max_completion_tokens).toBe(
            DEFAULT_MAX_COMPLETION_TOKENS,
        );
        expect(adjustedPayload.max_tokens).toBeUndefined();
    });
});
