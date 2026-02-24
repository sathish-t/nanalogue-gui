// Tests for AI Chat New Chat reset and generation guard.
// Verifies that New Chat clears stale state and late async responses are discarded.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Result from the list-models IPC handler (mirrors ai-chat.ts). */
interface ListModelsResult {
    /** Whether the request succeeded. */
    success: boolean;
    /** Available model IDs. */
    models?: string[];
    /** Error message when success is false. */
    error?: string;
    /** Endpoint origin when consent is required. */
    origin?: string;
}

/** Result from the send-message IPC handler (mirrors ai-chat.ts). */
interface SendMessageResult {
    /** Whether the request succeeded. */
    success: boolean;
    /** The assistant's text response. */
    text?: string;
    /** Tool execution steps for the code panel. */
    steps?: Array<{
        /** The Python code that was executed. */
        code: string;
        /** The sandbox execution result. */
        result: unknown;
    }>;
    /** Error message when success is false. */
    error?: string;
    /** Whether the error was a timeout. */
    isTimeout?: boolean;
    /** Endpoint origin requiring consent. */
    origin?: string;
}

/** Shape of the mock preload API. */
interface MockApi {
    /** Launch the AI Chat mode. */
    launchAiChat: ReturnType<typeof vi.fn>;
    /** Query endpoint for available models. */
    aiChatListModels: ReturnType<typeof vi.fn>;
    /** Send a user message. */
    aiChatSendMessage: ReturnType<typeof vi.fn>;
    /** Cancel the current request. */
    aiChatCancel: ReturnType<typeof vi.fn>;
    /** Reset conversation state. */
    aiChatNewChat: ReturnType<typeof vi.fn>;
    /** Open directory picker. */
    aiChatPickDirectory: ReturnType<typeof vi.fn>;
    /** Navigate back to landing. */
    aiChatGoBack: ReturnType<typeof vi.fn>;
    /** Record endpoint consent. */
    aiChatConsent: ReturnType<typeof vi.fn>;
    /** Register event listener. */
    onAiChatEvent: ReturnType<typeof vi.fn>;
}

/**
 * Loads the ai-chat.html template into the jsdom document.
 */
function loadHtml(): void {
    const htmlPath = join(import.meta.dirname, "ai-chat.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
}

/**
 * Creates a mock API with sensible defaults for all IPC methods.
 *
 * @returns The mock API object.
 */
function createMockApi(): MockApi {
    return {
        launchAiChat: vi.fn().mockResolvedValue({ success: true }),
        aiChatListModels: vi.fn().mockResolvedValue({
            success: true,
            models: ["model-a", "model-b"],
        }),
        aiChatSendMessage: vi
            .fn()
            .mockResolvedValue({ success: true, text: "response" }),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatNewChat: vi.fn().mockResolvedValue(undefined),
        aiChatPickDirectory: vi.fn().mockResolvedValue(null),
        aiChatGoBack: vi.fn().mockResolvedValue(undefined),
        aiChatConsent: vi.fn().mockResolvedValue(undefined),
        onAiChatEvent: vi.fn().mockReturnValue(() => {}),
    };
}

/**
 * Waits for all pending microtasks to flush (resolved promises, etc.).
 */
async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe("AI Chat New Chat reset", () => {
    /** Mock API injected into window before the module loads. */
    let mockApi: MockApi;

    beforeEach(async () => {
        vi.resetModules();
        loadHtml();
        mockApi = createMockApi();
        (window as unknown as { /** The preload API. */ api: MockApi }).api =
            mockApi;
        await import("./ai-chat");
    });

    afterEach(() => {
        document.documentElement.innerHTML = "";
    });

    /**
     * Simulates a successful Fetch Models flow by filling in the endpoint
     * and clicking the fetch button.
     */
    async function fetchModels(): Promise<void> {
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        const btn = document.getElementById(
            "btn-fetch-models",
        ) as HTMLButtonElement;
        btn.click();
        await flushMicrotasks();
    }

    /**
     * Clicks the New Chat button and waits for async effects to settle.
     */
    async function clickNewChat(): Promise<void> {
        const btn = document.getElementById(
            "btn-new-chat",
        ) as HTMLButtonElement;
        btn.click();
        await flushMicrotasks();
    }

    it("clears fetch status text on New Chat", async () => {
        await fetchModels();
        const fetchStatus = document.getElementById(
            "fetch-status",
        ) as HTMLElement;
        expect(fetchStatus.textContent).toContain("Found 2 model(s)");

        await clickNewChat();
        expect(fetchStatus.textContent).toBe("");
    });

    it("empties model dropdown on New Chat", async () => {
        await fetchModels();
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.children.length).toBeGreaterThan(0);

        await clickNewChat();
        expect(dropdown.innerHTML).toBe("");
    });

    it("resets connection status from connected to idle on New Chat", async () => {
        await fetchModels();
        const status = document.getElementById(
            "connection-status",
        ) as HTMLDivElement;
        expect(status.textContent).toContain("Connected");

        await clickNewChat();
        expect(status.textContent).not.toContain("Connected");
    });

    it("shows idle endpoint label after New Chat when endpoint is still filled", async () => {
        await fetchModels();
        await clickNewChat();

        const status = document.getElementById(
            "connection-status",
        ) as HTMLDivElement;
        // Endpoint field still has localhost value, so status should show idle label
        expect(status.textContent).toBe("Local endpoint");
    });

    it("clears chat messages on New Chat", async () => {
        // Simulate sending a message
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        const inputDir = document.getElementById(
            "input-dir",
        ) as HTMLInputElement;
        inputDir.value = "/tmp/bam";
        const inputModel = document.getElementById(
            "input-model",
        ) as HTMLInputElement;
        inputModel.value = "model-a";
        const inputMessage = document.getElementById(
            "input-message",
        ) as HTMLInputElement;
        inputMessage.value = "hello";

        const btnSend = document.getElementById(
            "btn-send",
        ) as HTMLButtonElement;
        btnSend.click();
        await flushMicrotasks();

        const chatMessages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        expect(chatMessages.children.length).toBeGreaterThan(0);

        await clickNewChat();
        expect(chatMessages.innerHTML).toBe("");
    });
});

describe("AI Chat generation guard", () => {
    /** Mock API injected into window before the module loads. */
    let mockApi: MockApi;

    beforeEach(async () => {
        vi.resetModules();
        loadHtml();
        mockApi = createMockApi();
        (window as unknown as { /** The preload API. */ api: MockApi }).api =
            mockApi;
        await import("./ai-chat");
    });

    afterEach(() => {
        document.documentElement.innerHTML = "";
    });

    it("discards late fetch-models response after New Chat", async () => {
        let resolveModels!: (value: ListModelsResult) => void;
        mockApi.aiChatListModels.mockReturnValueOnce(
            new Promise<ListModelsResult>((resolve) => {
                resolveModels = resolve;
            }),
        );

        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        const btnFetch = document.getElementById(
            "btn-fetch-models",
        ) as HTMLButtonElement;
        btnFetch.click();

        // New Chat while fetch is in flight
        const btnNewChat = document.getElementById(
            "btn-new-chat",
        ) as HTMLButtonElement;
        btnNewChat.click();
        await flushMicrotasks();
        expect(document.getElementById("fetch-status")?.textContent).toBe("");

        // Late response arrives after New Chat
        resolveModels({ success: true, models: ["stale-model"] });
        await flushMicrotasks();

        // Stale response must not populate dropdown or connection status
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.innerHTML).toBe("");
        expect(
            document.getElementById("connection-status")?.textContent,
        ).not.toContain("Connected");
        expect(document.getElementById("fetch-status")?.textContent).toBe("");
    });

    it("discards late send-message response after New Chat", async () => {
        let resolveSend!: (value: SendMessageResult) => void;
        mockApi.aiChatSendMessage.mockReturnValueOnce(
            new Promise<SendMessageResult>((resolve) => {
                resolveSend = resolve;
            }),
        );

        // Fill required fields
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        const inputDir = document.getElementById(
            "input-dir",
        ) as HTMLInputElement;
        inputDir.value = "/tmp/bam";
        const inputModel = document.getElementById(
            "input-model",
        ) as HTMLInputElement;
        inputModel.value = "model-a";
        const inputMessage = document.getElementById(
            "input-message",
        ) as HTMLInputElement;
        inputMessage.value = "hello";

        // Send message (will block on deferred promise)
        const btnSend = document.getElementById(
            "btn-send",
        ) as HTMLButtonElement;
        btnSend.click();
        await flushMicrotasks();

        // New Chat while send is in flight
        const btnNewChat = document.getElementById(
            "btn-new-chat",
        ) as HTMLButtonElement;
        btnNewChat.click();
        await flushMicrotasks();
        const chatMessages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        expect(chatMessages.innerHTML).toBe("");

        // Late response arrives after New Chat
        resolveSend({ success: true, text: "stale response" });
        await flushMicrotasks();

        // Stale response must not be appended to the chat
        expect(chatMessages.textContent).not.toContain("stale response");
    });

    it("does not append error when stale send resolves during New Chat IPC", async () => {
        let resolveSend!: (value: SendMessageResult) => void;
        mockApi.aiChatSendMessage.mockReturnValueOnce(
            new Promise<SendMessageResult>((resolve) => {
                resolveSend = resolve;
            }),
        );

        // aiChatNewChat mock simulates the main process aborting the in-flight
        // send during session.reset() — the send promise resolves while
        // the New Chat handler is still awaiting aiChatNewChat.
        let resolveNewChat!: () => void;
        mockApi.aiChatNewChat.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveNewChat = resolve;
            }),
        );

        // Fill required fields and send
        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        (document.getElementById("input-dir") as HTMLInputElement).value =
            "/tmp/bam";
        (document.getElementById("input-model") as HTMLInputElement).value =
            "model-a";
        (document.getElementById("input-message") as HTMLInputElement).value =
            "hello";
        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Click New Chat — handler starts but blocks on deferred aiChatNewChat
        (document.getElementById("btn-new-chat") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Stale send resolves while New Chat handler is still awaiting
        resolveSend({ success: false, error: "Request superseded" });
        await flushMicrotasks();

        // New Chat hasn't finished yet (still awaiting resolveNewChat), so
        // innerHTML hasn't been cleared. If the stale error leaked through
        // the generation guard, it would be visible here.
        const chatMessages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        expect(chatMessages.textContent).not.toContain("Request superseded");

        // Let New Chat finish
        resolveNewChat();
        await flushMicrotasks();
    });

    it("accepts fetch response when no New Chat intervened", async () => {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });

        const endpoint = document.getElementById(
            "input-endpoint",
        ) as HTMLInputElement;
        endpoint.value = "http://localhost:11434/v1";
        const btnFetch = document.getElementById(
            "btn-fetch-models",
        ) as HTMLButtonElement;
        btnFetch.click();
        await flushMicrotasks();

        // Response should be accepted normally
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.children.length).toBe(2);
        expect(
            document.getElementById("connection-status")?.textContent,
        ).toContain("Connected");
    });
});
