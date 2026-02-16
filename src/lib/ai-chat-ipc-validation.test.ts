// Tests for validateSendMessage config validation.
// Ensures IPC payloads are validated correctly.

import { describe, expect, it } from "vitest";
import { CONFIG_FIELD_SPECS } from "./ai-chat-constants";
import { validateSendMessage } from "./ai-chat-ipc-validation";

/**
 * Builds a valid base payload for validateSendMessage.
 *
 * @param overrides - Optional fields to override in the payload.
 * @returns A record matching the expected shape of a send-message payload.
 */
function validPayload(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        endpointUrl: "http://localhost:11434/v1",
        apiKey: "",
        model: "test-model",
        message: "hello",
        allowedDir: "/tmp",
        config: {},
        ...overrides,
    };
}

describe("validateSendMessage config validation", () => {
    it("uses fallback for missing config", () => {
        const result = validateSendMessage(validPayload());
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.contextWindowTokens).toBe(
                CONFIG_FIELD_SPECS.contextWindowTokens.fallback,
            );
        }
    });

    it("uses fallback for non-numeric values", () => {
        const result = validateSendMessage(
            validPayload({ config: { maxRetries: "abc" } }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.maxRetries).toBe(
                CONFIG_FIELD_SPECS.maxRetries.fallback,
            );
        }
    });

    it("rejects below-minimum values", () => {
        const result = validateSendMessage(
            validPayload({ config: { timeoutSeconds: 1 } }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("timeout seconds");
            expect(result.error).toContain("got 1");
        }
    });

    it("rejects above-maximum values", () => {
        const result = validateSendMessage(
            validPayload({ config: { maxRetries: 100 } }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("max retries");
            expect(result.error).toContain("got 100");
        }
    });

    it("accepts and rounds valid numbers", () => {
        const result = validateSendMessage(
            validPayload({ config: { timeoutSeconds: 60.7 } }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.timeoutSeconds).toBe(61);
        }
    });

    it("accepts boundary values", () => {
        const result = validateSendMessage(
            validPayload({ config: { maxRetries: 1 } }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.maxRetries).toBe(1);
        }
    });

    it("collects multiple field errors", () => {
        const result = validateSendMessage(
            validPayload({
                config: { timeoutSeconds: 1, maxRetries: 100 },
            }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("timeout seconds");
            expect(result.error).toContain("max retries");
        }
    });
});
