// Tests for validateSendMessage config validation.
// Ensures IPC payloads are validated correctly.

import { describe, expect, it } from "vitest";
import { CONFIG_FIELD_SPECS } from "./ai-chat-constants";
import {
    validateListModels,
    validateSendMessage,
} from "./ai-chat-ipc-validation";

/**
 * Builds a valid base payload for validateListModels.
 *
 * @param overrides - Optional fields to override in the payload.
 * @returns A record matching the expected shape of a list-models payload.
 */
function validListModelsPayload(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        endpointUrl: "http://localhost:11434/v1",
        apiKey: "test-key",
        ...overrides,
    };
}

/**
 * Builds a valid base payload for validateSendMessage.
 *
 * @param overrides - Optional fields to override in the payload.
 * @returns A record matching the expected shape of a send-message payload.
 */
function validSendPayload(
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

describe("validateListModels", () => {
    it("rejects null payload", () => {
        const result = validateListModels(null);
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toBe("Payload must be an object");
        }
    });

    it("rejects non-object payload", () => {
        const result = validateListModels("not-an-object");
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toBe("Payload must be an object");
        }
    });

    it("rejects missing endpointUrl", () => {
        const result = validateListModels({ apiKey: "key" });
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toBe("endpointUrl is required");
        }
    });

    it("rejects empty endpointUrl", () => {
        const result = validateListModels(
            validListModelsPayload({ endpointUrl: "" }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toBe("endpointUrl is required");
        }
    });

    it("rejects malformed URL", () => {
        const result = validateListModels(
            validListModelsPayload({ endpointUrl: "not-a-url" }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("Invalid URL");
        }
    });

    it("rejects URL with embedded credentials", () => {
        const result = validateListModels(
            validListModelsPayload({
                endpointUrl: "http://user:pass@localhost:11434/v1",
            }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toBe(
                "URL must not contain embedded credentials",
            );
        }
    });

    it("rejects URL with unsupported scheme", () => {
        const result = validateListModels(
            validListModelsPayload({ endpointUrl: "ftp://localhost/v1" }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("Unsupported URL scheme");
        }
    });

    it("defaults apiKey to empty string when missing", () => {
        const result = validateListModels({
            endpointUrl: "http://localhost/v1",
        });
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.apiKey).toBe("");
        }
    });

    it("defaults apiKey to empty string when non-string", () => {
        const result = validateListModels(
            validListModelsPayload({ apiKey: 42 }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.apiKey).toBe("");
        }
    });

    it("accepts valid payload with http URL", () => {
        const result = validateListModels(validListModelsPayload());
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.endpointUrl).toBe("http://localhost:11434/v1");
            expect(result.data.apiKey).toBe("test-key");
        }
    });

    it("accepts valid payload with https URL", () => {
        const result = validateListModels(
            validListModelsPayload({
                endpointUrl: "https://api.example.com/v1",
            }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.endpointUrl).toBe("https://api.example.com/v1");
        }
    });
});

describe("validateSendMessage config validation", () => {
    it("uses fallback for missing config", () => {
        const result = validateSendMessage(validSendPayload());
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.contextWindowTokens).toBe(
                CONFIG_FIELD_SPECS.contextWindowTokens.fallback,
            );
        }
    });

    it("uses fallback for non-numeric values", () => {
        const result = validateSendMessage(
            validSendPayload({ config: { maxRetries: "abc" } }),
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
            validSendPayload({ config: { timeoutSeconds: 1 } }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("timeout seconds");
            expect(result.error).toContain("got 1");
        }
    });

    it("rejects above-maximum values", () => {
        const result = validateSendMessage(
            validSendPayload({ config: { maxRetries: 100 } }),
        );
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.error).toContain("max retries");
            expect(result.error).toContain("got 100");
        }
    });

    it("accepts and rounds valid numbers", () => {
        const result = validateSendMessage(
            validSendPayload({ config: { timeoutSeconds: 60.7 } }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.timeoutSeconds).toBe(61);
        }
    });

    it("accepts boundary values", () => {
        const result = validateSendMessage(
            validSendPayload({ config: { maxRetries: 1 } }),
        );
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.data.config.maxRetries).toBe(1);
        }
    });

    it("collects multiple field errors", () => {
        const result = validateSendMessage(
            validSendPayload({
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
