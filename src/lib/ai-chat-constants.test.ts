// Tests for ai-chat-constants module-load validation.
// Ensures CONFIG_FIELD_SPECS invariants hold and exported constants are well-formed.

import { describe, expect, it } from "vitest";
import {
    BYTES_PER_TOKEN,
    CONFIG_FIELD_SPECS,
    CONTEXT_BUDGET_FRACTION,
    MAX_MESSAGE_BYTES,
    MODEL_LIST_TIMEOUT_MS,
} from "./ai-chat-constants";

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
        expect(Object.keys(CONFIG_FIELD_SPECS)).toHaveLength(8);
    });
});

describe("ai-chat-constants scalar exports", () => {
    it("has BYTES_PER_TOKEN as a positive integer", () => {
        expect(BYTES_PER_TOKEN).toBeGreaterThan(0);
        expect(Number.isInteger(BYTES_PER_TOKEN)).toBe(true);
    });

    it("has CONTEXT_BUDGET_FRACTION between 0 and 1", () => {
        expect(CONTEXT_BUDGET_FRACTION).toBeGreaterThan(0);
        expect(CONTEXT_BUDGET_FRACTION).toBeLessThan(1);
    });

    it("has MAX_MESSAGE_BYTES as a positive integer", () => {
        expect(MAX_MESSAGE_BYTES).toBeGreaterThan(0);
        expect(Number.isInteger(MAX_MESSAGE_BYTES)).toBe(true);
    });

    it("has MODEL_LIST_TIMEOUT_MS as a positive integer", () => {
        expect(MODEL_LIST_TIMEOUT_MS).toBeGreaterThan(0);
        expect(Number.isInteger(MODEL_LIST_TIMEOUT_MS)).toBe(true);
    });
});
