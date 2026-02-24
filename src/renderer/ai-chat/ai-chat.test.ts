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

    it("discards late send-message response after cancel", async () => {
        mockApi.aiChatSendMessage.mockReturnValueOnce(
            new Promise<SendMessageResult>(() => {}),
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

        // Cancel while send is in flight — cancel handler calls setProcessing(false)
        (document.getElementById("btn-cancel") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Config fields should be re-enabled after cancel
        expect(
            (document.getElementById("input-dir") as HTMLInputElement).disabled,
        ).toBe(false);
        expect(
            (document.getElementById("btn-browse") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
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

describe("AI Chat config field locking during processing", () => {
    /** Mock API injected into window before the module loads. */
    let mockApi: MockApi;

    /** Config field IDs that should be disabled during processing. */
    const configFieldIds = [
        "input-dir",
        "input-endpoint",
        "input-api-key",
        "input-model",
    ];

    /** Config button IDs that should be disabled during processing. */
    const configButtonIds = ["btn-browse", "btn-fetch-models"];

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

    it("disables config fields when fetch-models is in flight", async () => {
        let resolveModels!: (value: ListModelsResult) => void;
        mockApi.aiChatListModels.mockReturnValueOnce(
            new Promise<ListModelsResult>((resolve) => {
                resolveModels = resolve;
            }),
        );

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Config fields should be disabled while fetch is in flight
        for (const id of configFieldIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be disabled`,
            ).toBe(true);
        }
        for (const id of configButtonIds) {
            expect(
                (document.getElementById(id) as HTMLButtonElement).disabled,
                `${id} should be disabled`,
            ).toBe(true);
        }

        // Clean up deferred promise
        resolveModels({ success: true, models: ["model-a"] });
        await flushMicrotasks();
    });

    it("re-enables config fields after fetch-models completes", async () => {
        let resolveModels!: (value: ListModelsResult) => void;
        mockApi.aiChatListModels.mockReturnValueOnce(
            new Promise<ListModelsResult>((resolve) => {
                resolveModels = resolve;
            }),
        );

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Resolve — fields should re-enable
        resolveModels({ success: true, models: ["model-a"] });
        await flushMicrotasks();

        for (const id of configFieldIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled`,
            ).toBe(false);
        }
        for (const id of configButtonIds) {
            expect(
                (document.getElementById(id) as HTMLButtonElement).disabled,
                `${id} should be re-enabled`,
            ).toBe(false);
        }
    });

    it("re-enables config fields after fetch-models fails", async () => {
        let resolveModels!: (value: ListModelsResult) => void;
        mockApi.aiChatListModels.mockReturnValueOnce(
            new Promise<ListModelsResult>((resolve) => {
                resolveModels = resolve;
            }),
        );

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Resolve with failure — fields should still re-enable
        resolveModels({ success: false, error: "connection refused" });
        await flushMicrotasks();

        for (const id of configFieldIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled after failure`,
            ).toBe(false);
        }
        for (const id of configButtonIds) {
            expect(
                (document.getElementById(id) as HTMLButtonElement).disabled,
                `${id} should be re-enabled after failure`,
            ).toBe(false);
        }
    });

    it("hides model dropdown during send", async () => {
        let resolveSend!: (value: SendMessageResult) => void;
        mockApi.aiChatSendMessage.mockReturnValueOnce(
            new Promise<SendMessageResult>((resolve) => {
                resolveSend = resolve;
            }),
        );

        // Fetch models first to populate the dropdown
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.children.length).toBeGreaterThan(0);

        // Fill remaining fields and send — dropdown should be hidden
        (document.getElementById("input-dir") as HTMLInputElement).value =
            "/tmp/bam";
        (document.getElementById("input-model") as HTMLInputElement).value =
            "model-a";
        (document.getElementById("input-message") as HTMLInputElement).value =
            "hello";
        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();

        expect(dropdown.classList.contains("hidden")).toBe(true);

        // Clean up
        resolveSend({ success: true, text: "done" });
        await flushMicrotasks();
    });

    it("re-enables config fields via New Chat after fetch/send race", async () => {
        let resolveModels!: (value: ListModelsResult) => void;
        mockApi.aiChatListModels.mockReturnValueOnce(
            new Promise<ListModelsResult>((resolve) => {
                resolveModels = resolve;
            }),
        );

        // Start fetch-models (disables config fields)
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Send first message while fetch is in flight — sets chatStarted=true
        (document.getElementById("input-dir") as HTMLInputElement).disabled =
            false;
        (document.getElementById("input-dir") as HTMLInputElement).value =
            "/tmp/bam";
        (document.getElementById("input-model") as HTMLInputElement).disabled =
            false;
        (document.getElementById("input-model") as HTMLInputElement).value =
            "model-a";
        (document.getElementById("input-message") as HTMLInputElement).value =
            "hello";
        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Fetch completes — setConfigFieldsDisabled(false) skipped (chatStarted=true)
        resolveModels({ success: true, models: ["model-a"] });
        await flushMicrotasks();

        // New Chat should re-enable everything
        (document.getElementById("btn-new-chat") as HTMLButtonElement).click();
        await flushMicrotasks();

        for (const id of configFieldIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled after New Chat`,
            ).toBe(false);
        }
        for (const id of configButtonIds) {
            expect(
                (document.getElementById(id) as HTMLButtonElement).disabled,
                `${id} should be re-enabled after New Chat`,
            ).toBe(false);
        }
    });
});

describe("AI Chat permanent session config locking", () => {
    /** Mock API injected into window before the module loads. */
    let mockApi: MockApi;

    /** The six main config controls locked on first successful send. */
    const mainConfigIds = [
        "input-dir",
        "btn-browse",
        "input-endpoint",
        "input-api-key",
        "input-model",
        "btn-fetch-models",
    ];

    /** All 18 disableable field/button IDs that lock on first successful send. */
    const allLockableIds = [
        ...mainConfigIds,
        "opt-context-window",
        "opt-max-retries",
        "opt-timeout",
        "opt-max-read-info",
        "opt-max-bam-mods",
        "opt-max-window-reads",
        "opt-max-seq-table",
        "opt-max-code-rounds",
        "opt-max-duration",
        "opt-max-memory",
        "opt-max-allocations",
        "opt-temperature",
    ];

    beforeEach(async () => {
        vi.resetModules();
        loadHtml();

        // jsdom does not implement HTMLDialogElement methods — stub them
        const consentDialog = document.getElementById(
            "consent-dialog",
        ) as HTMLDialogElement;
        consentDialog.showModal = vi.fn();
        consentDialog.close = vi.fn();
        const advancedDialog = document.getElementById(
            "advanced-dialog",
        ) as HTMLDialogElement;
        advancedDialog.showModal = vi.fn();
        advancedDialog.close = vi.fn();

        mockApi = createMockApi();
        (window as unknown as { /** The preload API. */ api: MockApi }).api =
            mockApi;
        await import("./ai-chat");
    });

    afterEach(() => {
        document.documentElement.innerHTML = "";
    });

    /**
     * Fills in the required config fields so a send can proceed past validation.
     */
    function fillRequiredFields(): void {
        (document.getElementById("input-dir") as HTMLInputElement).value =
            "/tmp/bam";
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (document.getElementById("input-model") as HTMLInputElement).value =
            "model-a";
    }

    /**
     * Sends a message by filling the input and clicking Send, then flushes microtasks.
     *
     * @param message - The message text to send.
     */
    async function sendMessage(message: string): Promise<void> {
        (document.getElementById("input-message") as HTMLInputElement).value =
            message;
        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();
    }

    it("disables all config fields after first successful send", async () => {
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: true,
            text: "ok",
        });
        await sendMessage("hello");

        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be disabled after successful send`,
            ).toBe(true);
        }
        // Model dropdown is a <div>, not a form control — check hidden class
        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.classList.contains("hidden")).toBe(true);
    });

    it("keeps config fields editable after a failed send", async () => {
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: false,
            error: "connection refused",
        });
        await sendMessage("hello");

        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should remain enabled after failed send`,
            ).toBe(false);
        }
    });

    it("keeps config fields editable after consent denial", async () => {
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: false,
            error: "CONSENT_REQUIRED",
            origin: "https://api.example.com",
        });

        // Start the send — will show consent dialog
        (document.getElementById("input-message") as HTMLInputElement).value =
            "hello";
        (document.getElementById("btn-send") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Dismiss consent dialog by clicking cancel
        (
            document.getElementById("btn-consent-cancel") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should remain enabled after consent denial`,
            ).toBe(false);
        }
    });

    it("re-enables all fields after New Chat following a permanent lock", async () => {
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: true,
            text: "ok",
        });
        await sendMessage("hello");

        // Verify locked first
        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be locked`,
            ).toBe(true);
        }

        // New Chat should unlock everything
        (document.getElementById("btn-new-chat") as HTMLButtonElement).click();
        await flushMicrotasks();

        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled after New Chat`,
            ).toBe(false);
        }
    });

    it("hides model dropdown after lock", async () => {
        // Fetch models first to populate the dropdown
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        expect(dropdown.children.length).toBeGreaterThan(0);

        // Send a successful message to lock config
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: true,
            text: "ok",
        });
        await sendMessage("hello");

        expect(dropdown.classList.contains("hidden")).toBe(true);
    });

    it("model dropdown mousedown is a no-op after lock", async () => {
        // Fetch models to populate dropdown (creates real option elements
        // with mousedown listeners that include the chatStarted guard)
        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        const dropdown = document.getElementById(
            "model-dropdown",
        ) as HTMLDivElement;
        // Grab a real option element before locking (hideModelDropdown only
        // toggles the hidden class, it does not remove child elements)
        const realOption = dropdown.querySelector(
            ".model-option",
        ) as HTMLDivElement;
        expect(realOption).not.toBeNull();

        // Send a successful message to lock config
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockResolvedValueOnce({
            success: true,
            text: "ok",
        });
        await sendMessage("hello");

        const inputModel = document.getElementById(
            "input-model",
        ) as HTMLInputElement;
        const originalValue = inputModel.value;

        // Force-show dropdown and click the real option
        dropdown.classList.remove("hidden");
        realOption.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true }),
        );
        await flushMicrotasks();

        expect(inputModel.value).toBe(originalValue);
    });

    it("does not lock config when stale successful response arrives after New Chat", async () => {
        let resolveSend!: (value: SendMessageResult) => void;
        mockApi.aiChatSendMessage.mockReturnValueOnce(
            new Promise<SendMessageResult>((resolve) => {
                resolveSend = resolve;
            }),
        );

        fillRequiredFields();
        await sendMessage("hello");

        // New Chat while send is in flight
        (document.getElementById("btn-new-chat") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Late success arrives after New Chat
        resolveSend({ success: true, text: "stale" });
        await flushMicrotasks();

        // Config fields should still be unlocked
        for (const id of allLockableIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be unlocked after stale response`,
            ).toBe(false);
        }
    });

    it("recovers UI when send IPC rejects unexpectedly", async () => {
        fillRequiredFields();
        mockApi.aiChatSendMessage.mockRejectedValueOnce(
            new Error("IPC channel error"),
        );
        await sendMessage("hello");

        // Spinner should be hidden and config fields re-enabled
        const spinner = document.getElementById(
            "chat-spinner",
        ) as HTMLDivElement;
        expect(spinner.classList.contains("hidden")).toBe(true);

        const btnSend = document.getElementById(
            "btn-send",
        ) as HTMLButtonElement;
        expect(btnSend.classList.contains("hidden")).toBe(false);

        // Main config fields should be re-enabled (not stuck disabled)
        for (const id of mainConfigIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled after IPC rejection`,
            ).toBe(false);
        }

        // Error message should appear in chat
        const chatMessages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        expect(chatMessages.textContent).toContain("Unexpected error");
    });

    it("recovers UI when fetch-models IPC rejects unexpectedly", async () => {
        mockApi.aiChatListModels.mockRejectedValueOnce(
            new Error("IPC channel error"),
        );

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "http://localhost:11434/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Fetch status should show error
        const fetchStatus = document.getElementById(
            "fetch-status",
        ) as HTMLElement;
        expect(fetchStatus.textContent).toContain("Unexpected error");

        // Fetch Models button should be re-enabled
        const btnFetch = document.getElementById(
            "btn-fetch-models",
        ) as HTMLButtonElement;
        expect(btnFetch.disabled).toBe(false);

        // Config fields should be re-enabled
        const configFieldIds = [
            "input-dir",
            "btn-browse",
            "input-endpoint",
            "input-api-key",
            "input-model",
        ];
        for (const id of configFieldIds) {
            expect(
                (document.getElementById(id) as HTMLInputElement).disabled,
                `${id} should be re-enabled after fetch rejection`,
            ).toBe(false);
        }
    });

    it("does not call consent or retry fetch-models after New Chat during consent dialog", async () => {
        mockApi.aiChatListModels.mockResolvedValueOnce({
            success: false,
            error: "CONSENT_REQUIRED",
            origin: "https://api.example.com",
        });

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "https://api.example.com/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // Consent dialog is now open — click New Chat
        (document.getElementById("btn-new-chat") as HTMLButtonElement).click();
        await flushMicrotasks();

        // Accept consent after New Chat has reset the session
        (
            document.getElementById("btn-consent-accept") as HTMLButtonElement
        ).click();
        await flushMicrotasks();

        // aiChatConsent should not have been called — the generation guard
        // should have bailed out before recording consent for a stale session
        expect(mockApi.aiChatConsent).not.toHaveBeenCalled();
        // aiChatListModels should only have been called once (the initial call),
        // not retried after consent
        expect(mockApi.aiChatListModels).toHaveBeenCalledTimes(1);
    });

    it("auto-dismisses fetch-models consent denial message after timeout", async () => {
        vi.useFakeTimers();

        mockApi.aiChatListModels.mockResolvedValueOnce({
            success: false,
            error: "CONSENT_REQUIRED",
            origin: "https://api.example.com",
        });

        (document.getElementById("input-endpoint") as HTMLInputElement).value =
            "https://api.example.com/v1";
        (
            document.getElementById("btn-fetch-models") as HTMLButtonElement
        ).click();
        await vi.advanceTimersByTimeAsync(0);

        // Deny consent
        (
            document.getElementById("btn-consent-cancel") as HTMLButtonElement
        ).click();
        await vi.advanceTimersByTimeAsync(0);

        const fetchStatus = document.getElementById(
            "fetch-status",
        ) as HTMLElement;
        expect(fetchStatus.textContent).toBe("Endpoint consent denied.");

        // After 8 seconds the message should auto-clear
        await vi.advanceTimersByTimeAsync(8000);
        expect(fetchStatus.textContent).toBe("");

        vi.useRealTimers();
    });
});
