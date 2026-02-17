// Integration tests for multi-provider model listing against real APIs.
// These tests are skipped when API keys are not available in the environment.

import { describe, expect, it } from "vitest";
import { fetchModels } from "./model-listing";

const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
const googleKey = process.env.GOOGLE_API_KEY ?? "";
const openaiKey = process.env.OPENAI_API_KEY ?? "";

describe.skipIf(!anthropicKey)("fetchModels — Anthropic (live)", () => {
    it("returns at least one model", async () => {
        const result = await fetchModels(
            "https://api.anthropic.com/v1",
            anthropicKey,
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.models.length).toBeGreaterThan(0);
            for (const id of result.models) {
                expect(id).toBeTruthy();
            }
        }
    });
});

describe.skipIf(!googleKey)("fetchModels — Google Gemini (live)", () => {
    it("returns at least one model", async () => {
        const result = await fetchModels(
            "https://generativelanguage.googleapis.com/v1beta",
            googleKey,
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.models.length).toBeGreaterThan(0);
            for (const id of result.models) {
                expect(id).toBeTruthy();
                expect(id).not.toMatch(/^models\//);
            }
        }
    });
});

describe.skipIf(!openaiKey)("fetchModels — OpenAI (live)", () => {
    it("returns at least one model", async () => {
        const result = await fetchModels(
            "https://api.openai.com/v1",
            openaiKey,
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.models.length).toBeGreaterThan(0);
            for (const id of result.models) {
                expect(id).toBeTruthy();
            }
        }
    });
});
