// Tests for ai-chat-constants module-load validation.
// Ensures CONFIG_FIELD_SPECS invariants hold (min <= fallback <= max).

import { describe, expect, it } from "vitest";
import { CONFIG_FIELD_SPECS } from "./ai-chat-constants";

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
});
