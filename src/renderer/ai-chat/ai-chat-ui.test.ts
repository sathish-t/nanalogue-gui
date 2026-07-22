// Tests for extracted AI Chat UI helpers.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeStep } from "./ai-chat-types";

/**
 * Loads the ai-chat.html template into the jsdom document.
 */
function loadHtml(): void {
    const htmlPath = join(import.meta.dirname, "ai-chat.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
}

describe("ai-chat-ui", () => {
    beforeEach(() => {
        vi.resetModules();
        loadHtml();
    });

    it("shows the empty code-panel state when there are no steps", async () => {
        const { showCodePage } = await import("./ai-chat-ui");
        const codeDisplay = document.getElementById(
            "code-display",
        ) as HTMLPreElement;
        const indicator = document.getElementById(
            "code-page-indicator",
        ) as HTMLSpanElement;
        const btnCopy = document.getElementById(
            "btn-copy-code",
        ) as HTMLButtonElement;

        expect(showCodePage([], 0)).toBe(0);
        expect(codeDisplay.textContent).toBe("No code executed yet.");
        expect(indicator.textContent).toBe("0 / 0");
        expect(btnCopy.disabled).toBe(true);
    });

    it("clamps code-panel paging to the available step range", async () => {
        const { showCodePage } = await import("./ai-chat-ui");
        const codeDisplay = document.getElementById(
            "code-display",
        ) as HTMLPreElement;
        const indicator = document.getElementById(
            "code-page-indicator",
        ) as HTMLSpanElement;
        const btnCopy = document.getElementById(
            "btn-copy-code",
        ) as HTMLButtonElement;
        const codeSteps: CodeStep[] = [
            { code: 'print("one")', result: 1 },
            { code: 'print("two")', result: 2 },
        ];

        expect(showCodePage(codeSteps, 99)).toBe(1);
        expect(codeDisplay.textContent).toBe('print("two")');
        expect(indicator.textContent).toBe("2 / 2");
        expect(btnCopy.disabled).toBe(false);
    });

    it("updates connection status for empty, invalid, local, and remote endpoints", async () => {
        const { updateConnectionStatus } = await import("./ai-chat-ui");
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        const status = document.getElementById(
            "connection-status",
        ) as HTMLDivElement;

        endpoint.value = "";
        updateConnectionStatus(false);
        expect(status.textContent).toBe("");
        expect(status.className).toBe("status-indicator");

        endpoint.value = "not a url";
        updateConnectionStatus(false);
        expect(status.textContent).toBe("");
        expect(status.className).toBe("status-indicator");

        endpoint.value = "http://localhost:11434/v1";
        updateConnectionStatus(false);
        expect(status.textContent).toBe("Local endpoint");
        expect(status.className).toContain("status-idle");

        endpoint.value = "http://example.com/v1";
        updateConnectionStatus(true);
        expect(status.textContent).toContain("Connected (remote, HTTP)");
        expect(status.className).toContain("status-warning");
    });

    it("filters the model dropdown and updates the model input on selection", async () => {
        const { showModelDropdown } = await import("./ai-chat-ui");
        const inputModel = document.getElementById(
            "input-model",
        ) as HTMLInputElement;
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;

        inputModel.value = "cla";
        showModelDropdown(["claude-1", "gpt-4o"], inputModel.value, false);

        expect(dropdown.classList.contains("hidden")).toBe(false);
        expect(dropdown.children).toHaveLength(1);
        expect(dropdown.textContent).toContain("claude-1");

        const firstOption = dropdown.children[0] as HTMLDivElement;
        firstOption.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );

        expect(inputModel.value).toBe("claude-1");
        expect(dropdown.classList.contains("hidden")).toBe(true);
    });

    it("hides the model dropdown when there are no matches", async () => {
        const { showModelDropdown, hideModelDropdown } = await import(
            "./ai-chat-ui"
        );
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;

        showModelDropdown(["claude-1"], "zzz", false);
        expect(dropdown.classList.contains("hidden")).toBe(true);

        dropdown.classList.remove("hidden");
        hideModelDropdown();
        expect(dropdown.classList.contains("hidden")).toBe(true);
    });

    it("does not update the model input from dropdown selection after chat starts", async () => {
        const { showModelDropdown } = await import("./ai-chat-ui");
        const inputModel = document.getElementById(
            "input-model",
        ) as HTMLInputElement;
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;

        inputModel.value = "original-model";
        showModelDropdown(["claude-1"], "cla", true);

        const firstOption = dropdown.children[0] as HTMLDivElement;
        firstOption.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );

        expect(inputModel.value).toBe("original-model");
    });

    it("appends chat messages and updates spinner text", async () => {
        const { appendMessage, setSpinner } = await import("./ai-chat-ui");
        const messages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        const spinner = document.getElementById(
            "chat-spinner",
        ) as HTMLDivElement;
        const spinnerText = document.getElementById(
            "spinner-text",
        ) as HTMLSpanElement;

        appendMessage("assistant", "hello");
        expect(messages.textContent).toContain("Assistant");
        expect(messages.textContent).toContain("hello");

        setSpinner(true, "Running sandbox code...");
        expect(spinner.classList.contains("hidden")).toBe(false);
        expect(spinnerText.textContent).toBe("Running sandbox code...");

        setSpinner(false);
        expect(spinner.classList.contains("hidden")).toBe(true);
    });
});
