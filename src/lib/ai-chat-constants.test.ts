// Tests for ai-chat-constants module-load validation.
// Ensures CONFIG_FIELD_SPECS invariants hold and exported constants are well-formed.

import { describe, expect, it } from "vitest";
import {
    CONFIG_FIELD_SPECS,
    DEFAULT_MAX_BLANK_RETRIES,
    DEFAULT_MAX_COMPLETION_TOKENS,
    MAX_INPUT_CONTEXT_FRACTION,
    MAX_MESSAGE_BYTES,
    MODEL_LIST_TIMEOUT_MS,
    NOMINAL_BYTES_PER_TOKEN,
} from "./ai-chat-constants";
import {
    MAX_PYTHON_SOURCE_BYTES,
    MAX_SYSTEM_PROMPT_BYTES,
} from "./ai-chat-shared-constants";

describe("ai-chat-constants", () => {
    it("validates CONFIG_FIELD_SPECS without throwing on import", async () => {
        await expect(import("./ai-chat-constants")).resolves.toBeDefined();
    });

    it("has min <= fallback <= max for every field", () => {
        for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
            expect(spec.min, `${key}.min <= max`).toBeLessThanOrEqual(spec.max);
            expect(
                spec.fallback,
                `${key}.fallback >= min`,
            ).toBeGreaterThanOrEqual(spec.min);
            expect(spec.fallback, `${key}.fallback <= max`).toBeLessThanOrEqual(
                spec.max,
            );
        }
    });

    it("has a non-empty label for every field", () => {
        for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
            expect(spec.label, `${key}.label`).toBeTruthy();
            expect(typeof spec.label, `${key}.label type`).toBe("string");
        }
    });

    it("has positive integer min and max for every field", () => {
        for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
            expect(spec.min, `${key}.min > 0`).toBeGreaterThan(0);
            expect(spec.max, `${key}.max > 0`).toBeGreaterThan(0);
            expect(Number.isInteger(spec.min), `${key}.min is integer`).toBe(
                true,
            );
            expect(Number.isInteger(spec.max), `${key}.max is integer`).toBe(
                true,
            );
        }
    });

    it("exports expected number of config fields", () => {
        expect(Object.keys(CONFIG_FIELD_SPECS)).toHaveLength(13);
    });
});

describe("ai-chat-constants scalar exports", () => {
    it("has NOMINAL_BYTES_PER_TOKEN as a positive integer", () => {
        expect(NOMINAL_BYTES_PER_TOKEN).toBeGreaterThan(0);
        expect(Number.isInteger(NOMINAL_BYTES_PER_TOKEN)).toBe(true);
    });

    it("has MAX_INPUT_CONTEXT_FRACTION between 0 and 1", () => {
        expect(MAX_INPUT_CONTEXT_FRACTION).toBeGreaterThan(0);
        expect(MAX_INPUT_CONTEXT_FRACTION).toBeLessThan(1);
    });

    it("uses the agreed chat input size limits", () => {
        expect(MAX_MESSAGE_BYTES).toBe(1024 * 1024);
        expect(MAX_SYSTEM_PROMPT_BYTES).toBe(1024 * 1024);
        expect(MAX_PYTHON_SOURCE_BYTES).toBe(10 * 1024 * 1024);
    });

    it("has MODEL_LIST_TIMEOUT_MS as a positive integer", () => {
        expect(MODEL_LIST_TIMEOUT_MS).toBeGreaterThan(0);
        expect(Number.isInteger(MODEL_LIST_TIMEOUT_MS)).toBe(true);
    });

    it("allows 16,384 completion tokens per LLM request", () => {
        expect(DEFAULT_MAX_COMPLETION_TOKENS).toBe(16_384);
    });

    it("retries blank assistant responses three times", () => {
        expect(DEFAULT_MAX_BLANK_RETRIES).toBe(3);
    });

    it("allows an optional 1,200-second LLM response timeout", () => {
        expect(CONFIG_FIELD_SPECS.timeoutSeconds).toMatchObject({
            max: 1_200,
            fallback: 60,
        });
    });
});
