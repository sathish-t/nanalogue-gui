// Tests for extracted AI Chat config helpers.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_FIELD_SPECS } from "../../lib/ai-chat-shared-constants";

/**
 * Loads the ai-chat.html template into the jsdom document.
 */
function loadHtml(): void {
    const htmlPath = join(import.meta.dirname, "ai-chat.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
}

describe("ai-chat-config", () => {
    beforeEach(() => {
        vi.resetModules();
        loadHtml();
    });

    it("applies min/max bounds from CONFIG_FIELD_SPECS", async () => {
        const { applyConfigBounds } = await import("./ai-chat-config");
        const contextWindow = document.getElementById(
            "opt-context-window",
        ) as HTMLInputElement;
        const maxRetries = document.getElementById(
            "opt-max-retries",
        ) as HTMLInputElement;

        applyConfigBounds();

        expect(contextWindow.min).toBe(
            String(CONFIG_FIELD_SPECS.contextWindowTokens.min),
        );
        expect(contextWindow.max).toBe(
            String(CONFIG_FIELD_SPECS.contextWindowTokens.max),
        );
        expect(maxRetries.min).toBe(String(CONFIG_FIELD_SPECS.maxRetries.min));
        expect(maxRetries.max).toBe(String(CONFIG_FIELD_SPECS.maxRetries.max));
    });

    it("resets advanced options to their configured defaults", async () => {
        const { resetDefaults } = await import("./ai-chat-config");
        const timeout = document.getElementById(
            "opt-timeout",
        ) as HTMLInputElement;
        const maxReadMb = document.getElementById(
            "opt-max-read-mb",
        ) as HTMLInputElement;
        const temperature = document.getElementById(
            "opt-temperature",
        ) as HTMLInputElement;

        timeout.value = "999";
        maxReadMb.value = "123";
        temperature.value = "0.7";

        resetDefaults();

        expect(timeout.value).toBe(
            String(CONFIG_FIELD_SPECS.timeoutSeconds.fallback),
        );
        expect(maxReadMb.value).toBe(
            String(CONFIG_FIELD_SPECS.maxReadMB.fallback),
        );
        expect(temperature.value).toBe("");
    });

    it("returns parsed config values and preserves empty temperature as undefined", async () => {
        const { getConfig } = await import("./ai-chat-config");
        const contextWindow = document.getElementById(
            "opt-context-window",
        ) as HTMLInputElement;
        const timeout = document.getElementById(
            "opt-timeout",
        ) as HTMLInputElement;
        const temperature = document.getElementById(
            "opt-temperature",
        ) as HTMLInputElement;

        contextWindow.value = "2048";
        timeout.value = "120";
        temperature.value = "";

        const config = getConfig();

        expect(config.contextWindowTokens).toBe(2048);
        expect(config.timeoutSeconds).toBe(120);
        expect(config.temperature).toBeUndefined();
    });

    it("locks and unlocks session config controls", async () => {
        const { lockSessionConfig, unlockSessionConfig } = await import(
            "./ai-chat-config"
        );
        const inputDir = document.getElementById(
            "input-dir",
        ) as HTMLInputElement;
        const btnBrowse = document.getElementById(
            "btn-browse",
        ) as HTMLButtonElement;
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        const temperature = document.getElementById(
            "opt-temperature",
        ) as HTMLInputElement;

        lockSessionConfig();

        expect(inputDir.disabled).toBe(true);
        expect(btnBrowse.disabled).toBe(true);
        expect(endpoint.disabled).toBe(true);
        expect(temperature.disabled).toBe(true);

        unlockSessionConfig();

        expect(inputDir.disabled).toBe(false);
        expect(btnBrowse.disabled).toBe(false);
        expect(endpoint.disabled).toBe(false);
        expect(temperature.disabled).toBe(false);
    });

    it("validates required top-level config fields", async () => {
        const { validateConfig } = await import("./ai-chat-config");
        const inputDir = document.getElementById(
            "input-dir",
        ) as HTMLInputElement;
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        const model = document.getElementById(
            "input-model",
        ) as HTMLInputElement;

        expect(validateConfig()).toBe("Please select a BAM directory.");

        inputDir.value = "/tmp/bam";
        expect(validateConfig()).toBe("Please enter an endpoint URL.");

        endpoint.value = "http://localhost:11434/v1";
        expect(validateConfig()).toBe("Please enter a model name.");

        model.value = "gpt-test";
        expect(validateConfig()).toBeNull();
    });
});
