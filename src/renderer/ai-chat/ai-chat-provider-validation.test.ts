// Tests that AI Chat blocks provider requests with invalid configuration.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of the mock preload API used by provider validation tests. */
interface MockApi {
    /** Query an endpoint for available models. */
    aiChatListModels: ReturnType<typeof vi.fn>;
    /** Send a user message. */
    aiChatSendMessage: ReturnType<typeof vi.fn>;
    /** Cancel the current request. */
    aiChatCancel: ReturnType<typeof vi.fn>;
    /** Reset conversation state. */
    aiChatNewChat: ReturnType<typeof vi.fn>;
    /** Open the directory picker. */
    aiChatPickDirectory: ReturnType<typeof vi.fn>;
    /** Navigate back to the landing page. */
    aiChatGoBack: ReturnType<typeof vi.fn>;
    /** Record endpoint consent. */
    aiChatConsent: ReturnType<typeof vi.fn>;
    /** Retrieve the system prompt. */
    aiChatGetSystemPrompt: ReturnType<typeof vi.fn>;
    /** Register an AI Chat event listener. */
    onAiChatEvent: ReturnType<typeof vi.fn>;
}

/** Loads the AI Chat page into the test document. */
function loadAiChatHtml(): void {
    const htmlPath = join(import.meta.dirname, "ai-chat.html");
    document.documentElement.innerHTML = readFileSync(htmlPath, "utf-8");
}

/**
 * Creates the mock preload API required when AI Chat initializes.
 *
 * @returns The mock preload API.
 */
function createMockApi(): MockApi {
    return {
        aiChatListModels: vi.fn().mockResolvedValue({
            success: true,
            models: ["model-a"],
        }),
        aiChatSendMessage: vi
            .fn()
            .mockResolvedValue({ success: true, text: "response" }),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatNewChat: vi.fn().mockResolvedValue(undefined),
        aiChatPickDirectory: vi.fn().mockResolvedValue(null),
        aiChatGoBack: vi.fn().mockResolvedValue(undefined),
        aiChatConsent: vi.fn().mockResolvedValue(undefined),
        aiChatGetSystemPrompt: vi
            .fn()
            .mockResolvedValue({ success: true, prompt: "prompt" }),
        onAiChatEvent: vi.fn().mockReturnValue(() => {}),
    };
}

/** Waits for event-handler promises to settle. */
async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe("AI Chat provider validation", () => {
    /** Mock preload API injected before the renderer module loads. */
    let mockApi: MockApi;

    beforeEach(async () => {
        vi.resetModules();
        loadAiChatHtml();
        mockApi = createMockApi();
        (window as unknown as { /** The preload API. */ api: MockApi }).api =
            mockApi;
        vi.spyOn(window, "alert").mockImplementation(() => undefined);
        await import("./ai-chat");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.innerHTML = "";
    });

    /** Fills the provider fields with valid values. */
    function fillValidProviderFields(): void {
        (document.getElementById("input-dir") as HTMLInputElement).value =
            "/tmp/bam";
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (document.getElementById("input-model") as HTMLInputElement).value =
            "model-a";
    }

    it.each([
        ["input-endpoint", "ftp://example.com/v1", "Invalid endpoint URL."],
        ["input-api-key", " key", "Invalid API key."],
        ["input-model", " model", "Invalid model name."],
    ])("blocks sending when %s is invalid", async (fieldId, fieldValue, expectedAlert) => {
        fillValidProviderFields();
        (document.getElementById(fieldId) as HTMLInputElement).value =
            fieldValue;
        (document.getElementById("input-message") as HTMLInputElement).value =
            "hello";

        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(window.alert).toHaveBeenCalledWith(expectedAlert);
        expect(mockApi.aiChatSendMessage).not.toHaveBeenCalled();
    });

    it.each([
        ["input-endpoint", "https:///example.com/v1", "Invalid endpoint URL."],
        ["input-api-key", " key", "Invalid API key."],
    ])("blocks model fetching when %s is invalid", async (fieldId, fieldValue, expectedAlert) => {
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "https://example.com/v1";
        (document.getElementById(fieldId) as HTMLInputElement).value =
            fieldValue;

        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        expect(window.alert).toHaveBeenCalledWith(expectedAlert);
        expect(mockApi.aiChatListModels).not.toHaveBeenCalled();
    });
});
