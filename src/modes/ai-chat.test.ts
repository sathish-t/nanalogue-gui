// Tests for the AI Chat mode IPC handlers.
// Verifies that SYSTEM_APPEND.md content is loaded, cached, and passed to
// session.sendMessage, that the cache is cleared on session reset, and that
// the prompt-preview handler never primes the send cache.
//
// Uses top-level vi.mock (hoisted) with a single module import so that
// module-level state (session singleton, SYSTEM_APPEND.md cache) is stable
// and predictable across tests. Cache state is reset in beforeEach by
// invoking the ai-chat-new-chat handler, which triggers clearSystemAppendCache().

import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Mutable mock state — reassigned in beforeEach; class methods below read
// these variables at *call* time (not at instantiation time) so reassignment
// between tests is always reflected in the mock behaviour.
// ---------------------------------------------------------------------------

/** Current sendMessage mock — reset per test. */
let mockSendMessage: ReturnType<typeof vi.fn>;

/** Current reset mock — reset per test. */
let mockReset: ReturnType<typeof vi.fn>;

/** Current cancel mock — reset per test. */
let mockCancel: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Stable capture map: populated once when registerIpcHandlers() runs.
// ---------------------------------------------------------------------------

/** IPC handlers registered by registerIpcHandlers(), keyed by channel name. */
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted by vitest before any import).
// ---------------------------------------------------------------------------

// Mock electron so ipcMain.handle captures handlers into ipcHandlers.
vi.mock("electron", () => ({
    ipcMain: {
        /**
         * Captures the handler into ipcHandlers for test invocation.
         *
         * @param channel - The IPC channel name.
         * @param handler - The handler to register.
         */
        handle: (
            channel: string,
            handler: (...args: unknown[]) => Promise<unknown>,
        ) => {
            ipcHandlers.set(channel, handler);
        },
    },
    dialog: { showOpenDialog: vi.fn() },
    // BrowserWindow is only used by setMainWindow — a no-op class suffices.
    BrowserWindow: class {},
}));

// Mock ChatSession using class methods (not field initializers) so that
// mockSendMessage / mockReset are resolved at *call* time, not at
// instantiation time. This allows beforeEach to reassign the variables and
// have all subsequent calls to session.sendMessage() / session.reset() use
// the fresh vi.fn() objects.
vi.mock("../lib/chat-session", () => ({
    ChatSession: class MockChatSession {
        /**
         * Delegates to the current test's mockSendMessage.
         *
         * @param args - Forwarded to mockSendMessage.
         * @returns The mock return value.
         */
        sendMessage(...args: unknown[]): unknown {
            return mockSendMessage(...args);
        }

        /** Delegates to the current test's mockReset. */
        reset(): void {
            mockReset();
        }

        /** Delegates to the current test's mockCancel. */
        cancel(): void {
            mockCancel();
        }
    },
}));

// Mock loadSystemAppend — actual file I/O behaviour is covered by
// src/lib/system-append.test.ts; here we only test the IPC handler wiring.
vi.mock("../lib/system-append", () => ({
    loadSystemAppend: vi.fn(),
}));

// Mock fetchModels — actual network behaviour is covered by
// src/lib/model-listing.test.ts; here we only test the IPC handler wiring.
vi.mock("../lib/model-listing", () => ({
    fetchModels: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Top-level imports (run after mocks are applied).
// ---------------------------------------------------------------------------

// Import the mocked loadSystemAppend so tests can configure its return value.
const { loadSystemAppend } = await import("../lib/system-append");
// Import the mocked fetchModels so tests can configure its return value.
const { fetchModels } = await import("../lib/model-listing");
// Import dialog so tests can configure its showOpenDialog mock.
const { dialog } = await import("electron");
// Import both entry points from the module under test.
const { registerIpcHandlers, setMainWindow } = await import("./ai-chat");

// Register all IPC handlers once. ipcHandlers is populated as a side-effect.
registerIpcHandlers();

// ---------------------------------------------------------------------------
// Minimal valid payload shape for ai-chat-send-message.
// ---------------------------------------------------------------------------

/** Minimal valid send-message IPC payload. */
const BASE_PAYLOAD = {
    endpointUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3",
    message: "test message",
    allowedDir: "/tmp/test-data",
    config: {},
} as const;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ai-chat IPC handlers — SYSTEM_APPEND.md", () => {
    beforeAll(() => {
        // Handlers are registered once at module level above.
        // Verify the channels we need are present before any test runs.
        if (!ipcHandlers.has("ai-chat-send-message")) {
            throw new Error("ai-chat-send-message handler not registered");
        }
        if (!ipcHandlers.has("ai-chat-new-chat")) {
            throw new Error("ai-chat-new-chat handler not registered");
        }
        if (!ipcHandlers.has("ai-chat-go-back")) {
            throw new Error("ai-chat-go-back handler not registered");
        }
    });

    beforeEach(async () => {
        // Fresh vi.fn() objects so each test starts from a clean slate.
        mockSendMessage = vi.fn().mockResolvedValue({ text: "ok", steps: [] });
        mockReset = vi.fn();
        mockCancel = vi.fn();

        // Reset loadSystemAppend to return undefined by default.
        vi.mocked(loadSystemAppend).mockReset();
        vi.mocked(loadSystemAppend).mockResolvedValue(undefined);

        // Ensure mainWindow is null so pick-directory and emitEvent tests
        // start from a known state.
        setMainWindow(null);

        // Clear the ai-chat.ts SYSTEM_APPEND.md cache by triggering a
        // new-chat reset. This ensures each test starts with a cold cache
        // regardless of what the previous test did.
        await ipcHandlers.get("ai-chat-new-chat")?.();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    /**
     * Invokes the ai-chat-send-message handler with the given payload overrides.
     *
     * @param overrides - Fields to override in the base payload.
     * @returns The handler's return value.
     */
    async function invokeSendMessage(
        overrides: Partial<typeof BASE_PAYLOAD> = {},
    ): Promise<unknown> {
        const handler = ipcHandlers.get("ai-chat-send-message");
        if (!handler)
            throw new Error("ai-chat-send-message handler not registered");
        return handler(null, { ...BASE_PAYLOAD, ...overrides });
    }

    it("passes appendSystemPrompt to sendMessage when SYSTEM_APPEND.md exists", async () => {
        vi.mocked(loadSystemAppend).mockResolvedValue(
            "## Domain context\nFocus on CpG methylation.",
        );

        await invokeSendMessage();

        expect(mockSendMessage).toHaveBeenCalledOnce();
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                appendSystemPrompt:
                    "## Domain context\nFocus on CpG methylation.",
            }),
        );
    });

    it("passes undefined appendSystemPrompt when SYSTEM_APPEND.md is absent", async () => {
        vi.mocked(loadSystemAppend).mockResolvedValue(undefined);

        await invokeSendMessage();

        expect(mockSendMessage).toHaveBeenCalledOnce();
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ appendSystemPrompt: undefined }),
        );
    });

    it("calls loadSystemAppend with the correct allowedDir", async () => {
        await invokeSendMessage({ allowedDir: "/tmp/my-bam-data" });

        expect(loadSystemAppend).toHaveBeenCalledWith("/tmp/my-bam-data");
    });

    it("caches the result — loadSystemAppend is called only once for the same allowedDir", async () => {
        vi.mocked(loadSystemAppend).mockResolvedValue("## Cached context");

        await invokeSendMessage();
        await invokeSendMessage();
        await invokeSendMessage();

        // File must be read exactly once regardless of how many messages are sent.
        expect(loadSystemAppend).toHaveBeenCalledOnce();
        // Every sendMessage call must receive the cached content.
        for (const call of vi.mocked(mockSendMessage).mock.calls) {
            expect(call[0]).toMatchObject({
                appendSystemPrompt: "## Cached context",
            });
        }
    });

    it("re-reads the file when allowedDir changes between messages", async () => {
        vi.mocked(loadSystemAppend)
            .mockResolvedValueOnce("## Dir A context")
            .mockResolvedValueOnce("## Dir B context");

        await invokeSendMessage({ allowedDir: "/tmp/dir-a" });
        await invokeSendMessage({ allowedDir: "/tmp/dir-b" });

        expect(loadSystemAppend).toHaveBeenCalledTimes(2);
        expect(vi.mocked(mockSendMessage).mock.calls[0][0]).toMatchObject({
            appendSystemPrompt: "## Dir A context",
        });
        expect(vi.mocked(mockSendMessage).mock.calls[1][0]).toMatchObject({
            appendSystemPrompt: "## Dir B context",
        });
    });

    it("clears the cache and re-reads the file after ai-chat-new-chat", async () => {
        vi.mocked(loadSystemAppend).mockResolvedValue("## Session 1 context");
        await invokeSendMessage();
        expect(loadSystemAppend).toHaveBeenCalledOnce();

        // Trigger new-chat — should reset and clear the cache.
        await ipcHandlers.get("ai-chat-new-chat")?.();
        expect(mockReset).toHaveBeenCalled();

        vi.mocked(loadSystemAppend).mockResolvedValue("## Session 2 context");
        await invokeSendMessage();

        // File must be re-read after the cache was cleared.
        expect(loadSystemAppend).toHaveBeenCalledTimes(2);
        const lastCall = vi.mocked(mockSendMessage).mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({
            appendSystemPrompt: "## Session 2 context",
        });
    });

    it("concurrent sends for the same allowedDir trigger only one file read", async () => {
        // Simulate a slow file read so the second send arrives while the
        // first is still in-flight — both should share the same Promise.
        let resolveLoad!: (value: string | undefined) => void;
        vi.mocked(loadSystemAppend).mockImplementation(
            () =>
                new Promise<string | undefined>((resolve) => {
                    resolveLoad = resolve;
                }),
        );

        // Fire two sends without awaiting — both hit a cold cache.
        const p1 = invokeSendMessage();
        const p2 = invokeSendMessage();

        // Resolve the single in-flight read and let both sends complete.
        resolveLoad("## Shared context");
        await Promise.all([p1, p2]);

        // loadSystemAppend must have been called exactly once.
        expect(loadSystemAppend).toHaveBeenCalledOnce();
        // Both sends must have received the content.
        for (const call of vi.mocked(mockSendMessage).mock.calls) {
            expect(call[0]).toMatchObject({
                appendSystemPrompt: "## Shared context",
            });
        }
    });

    it("clears the cache and re-reads the file after ai-chat-go-back", async () => {
        vi.mocked(loadSystemAppend).mockResolvedValue("## Session 1 context");
        await invokeSendMessage();
        expect(loadSystemAppend).toHaveBeenCalledOnce();

        // Trigger go-back — should reset and clear the cache.
        await ipcHandlers.get("ai-chat-go-back")?.();
        expect(mockReset).toHaveBeenCalled();

        vi.mocked(loadSystemAppend).mockResolvedValue("## Session 2 context");
        await invokeSendMessage();

        // File must be re-read after the cache was cleared.
        expect(loadSystemAppend).toHaveBeenCalledTimes(2);
        const lastCall = vi.mocked(mockSendMessage).mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({
            appendSystemPrompt: "## Session 2 context",
        });
    });

    it("prompt preview does not prime the send cache", async () => {
        // Simulate the user clicking "View System Prompt" before sending.
        vi.mocked(loadSystemAppend).mockResolvedValue("## Old content");
        const previewHandler = ipcHandlers.get("ai-chat-get-system-prompt");
        if (!previewHandler)
            throw new Error("ai-chat-get-system-prompt handler not registered");
        await previewHandler(null, {
            config: {},
            allowedDir: BASE_PAYLOAD.allowedDir,
        });

        // The user edits SYSTEM_APPEND.md after seeing the preview.
        vi.mocked(loadSystemAppend).mockResolvedValue("## New content");

        // Send the first message — must pick up the new content, not the
        // stale value that the preview read.
        await invokeSendMessage();

        // loadSystemAppend must have been called twice: once for the preview
        // (direct read) and once for the send (which then populates the cache).
        // If this drops to one, the preview is accidentally sharing the cache.
        expect(loadSystemAppend).toHaveBeenCalledTimes(2);
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ appendSystemPrompt: "## New content" }),
        );
    });

    it("prompt preview uses the session cache mid-session", async () => {
        // Send the first message — this populates the cache.
        vi.mocked(loadSystemAppend).mockResolvedValue("## Session content");
        await invokeSendMessage();
        expect(loadSystemAppend).toHaveBeenCalledOnce();

        // Now the user edits SYSTEM_APPEND.md mid-session.
        vi.mocked(loadSystemAppend).mockResolvedValue("## Edited content");

        // Preview mid-session must show the cached value, not the edited file,
        // because the send path is also using the cached value.
        const previewHandler = ipcHandlers.get("ai-chat-get-system-prompt");
        if (!previewHandler)
            throw new Error("ai-chat-get-system-prompt handler not registered");
        const result = await previewHandler(null, {
            config: {},
            allowedDir: BASE_PAYLOAD.allowedDir,
        });

        // loadSystemAppend must not have been called again — preview must
        // have served the result from the warm cache.
        expect(loadSystemAppend).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            success: true,
            prompt: expect.stringContaining("## Session content"),
        });
    });
});

// ---------------------------------------------------------------------------
// Additional coverage: handlers not exercised by the SYSTEM_APPEND.md suite.
// ---------------------------------------------------------------------------

describe("ai-chat IPC handlers — additional coverage", () => {
    beforeEach(async () => {
        // Re-initialise all mock functions for a clean slate.
        mockSendMessage = vi.fn().mockResolvedValue({ text: "ok", steps: [] });
        mockReset = vi.fn();
        mockCancel = vi.fn();

        vi.mocked(loadSystemAppend).mockReset();
        vi.mocked(loadSystemAppend).mockResolvedValue(undefined);

        vi.mocked(fetchModels).mockReset();

        // Reset dialog mock so each test that needs it can set its own return.
        vi.mocked(dialog.showOpenDialog).mockReset();

        // Start with no main window so tests that need one can set it explicitly.
        setMainWindow(null);

        // Reset the SYSTEM_APPEND.md cache.
        await ipcHandlers.get("ai-chat-new-chat")?.();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // setMainWindow
    // -------------------------------------------------------------------------

    it("setMainWindow stores the window reference used by pick-directory", async () => {
        // With mainWindow = null the pick-directory handler returns null immediately.
        const handler = ipcHandlers.get("ai-chat-pick-directory");
        if (!handler) throw new Error("ai-chat-pick-directory not registered");

        expect(await handler()).toBeNull();

        // After setting a window, the handler should open the dialog instead.
        const mockWindow = { webContents: { send: vi.fn() } };
        setMainWindow(
            mockWindow as unknown as import("electron").BrowserWindow,
        );
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: true,
            filePaths: [],
        });

        // The result is still null (canceled), but the dialog was invoked —
        // proving that setMainWindow updated the reference used by the handler.
        expect(await handler()).toBeNull();
        expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
    });

    // -------------------------------------------------------------------------
    // emitEvent
    // -------------------------------------------------------------------------

    it("emitEvent forwards events to the renderer when mainWindow is set", async () => {
        const mockSend = vi.fn();
        const mockWindow = { webContents: { send: mockSend } };
        setMainWindow(
            mockWindow as unknown as import("electron").BrowserWindow,
        );

        // Capture the emitEvent callback that the send-message handler passes
        // to session.sendMessage, then invoke it directly.
        let capturedEmitEvent: ((event: unknown) => void) | undefined;

        /** Args shape accepted by session.sendMessage in the mock. */
        type SendArgs = {
            /** Event emitter callback forwarded from the send-message handler. */
            emitEvent: (event: unknown) => void;
        };
        mockSendMessage = vi.fn().mockImplementation((args: SendArgs) => {
            capturedEmitEvent = args.emitEvent;
            return Promise.resolve({ text: "ok", steps: [] });
        });

        const handler = ipcHandlers.get("ai-chat-send-message");
        if (!handler) throw new Error("ai-chat-send-message not registered");
        await handler(null, { ...BASE_PAYLOAD });

        expect(capturedEmitEvent).toBeDefined();
        if (capturedEmitEvent) {
            capturedEmitEvent({ type: "token", content: "hello" });
        }

        expect(mockSend).toHaveBeenCalledWith("ai-chat-event", {
            type: "token",
            content: "hello",
        });
    });

    // -------------------------------------------------------------------------
    // ai-chat-list-models
    // -------------------------------------------------------------------------

    it("list-models returns a validation error for an invalid payload", async () => {
        const handler = ipcHandlers.get("ai-chat-list-models");
        if (!handler) throw new Error("ai-chat-list-models not registered");

        const result = await handler(null, null);

        expect(result).toMatchObject({
            success: false,
            error: expect.any(String),
        });
        expect(fetchModels).not.toHaveBeenCalled();
    });

    it("list-models calls fetchModels for a localhost endpoint", async () => {
        vi.mocked(fetchModels).mockResolvedValue({
            success: true,
            models: ["llama3"],
        });

        const handler = ipcHandlers.get("ai-chat-list-models");
        if (!handler) throw new Error("ai-chat-list-models not registered");

        const result = await handler(null, {
            endpointUrl: "http://localhost:11434/v1",
            apiKey: "local-key",
        });

        expect(fetchModels).toHaveBeenCalledWith(
            "http://localhost:11434/v1",
            "local-key",
        );
        expect(result).toMatchObject({ success: true, models: ["llama3"] });
    });

    it("list-models returns CONSENT_REQUIRED for a non-localhost endpoint without consent", async () => {
        const handler = ipcHandlers.get("ai-chat-list-models");
        if (!handler) throw new Error("ai-chat-list-models not registered");

        const result = await handler(null, {
            endpointUrl: "http://unconsented-list-models.example.com/v1",
            apiKey: "",
        });

        expect(result).toMatchObject({
            success: false,
            error: "CONSENT_REQUIRED",
            origin: "http://unconsented-list-models.example.com",
        });
        expect(fetchModels).not.toHaveBeenCalled();
    });

    it("list-models calls fetchModels after consent is given for a non-localhost endpoint", async () => {
        vi.mocked(fetchModels).mockResolvedValue({
            success: true,
            models: ["gpt-4"],
        });

        // Grant consent for this unique origin.
        const consentHandler = ipcHandlers.get("ai-chat-consent");
        if (!consentHandler) throw new Error("ai-chat-consent not registered");
        await consentHandler(null, "http://consented-list-models.example.com");

        const handler = ipcHandlers.get("ai-chat-list-models");
        if (!handler) throw new Error("ai-chat-list-models not registered");

        const result = await handler(null, {
            endpointUrl: "http://consented-list-models.example.com/v1",
            apiKey: "remote-key",
        });

        expect(fetchModels).toHaveBeenCalledWith(
            "http://consented-list-models.example.com/v1",
            "remote-key",
        );
        expect(result).toMatchObject({ success: true, models: ["gpt-4"] });
    });

    // -------------------------------------------------------------------------
    // ai-chat-send-message — validation and consent paths not covered above
    // -------------------------------------------------------------------------

    it("send-message returns a validation error for an invalid payload", async () => {
        const handler = ipcHandlers.get("ai-chat-send-message");
        if (!handler) throw new Error("ai-chat-send-message not registered");

        const result = await handler(null, null);

        expect(result).toMatchObject({
            success: false,
            error: expect.any(String),
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("send-message returns CONSENT_REQUIRED for a non-localhost endpoint without consent", async () => {
        const handler = ipcHandlers.get("ai-chat-send-message");
        if (!handler) throw new Error("ai-chat-send-message not registered");

        const result = await handler(null, {
            ...BASE_PAYLOAD,
            endpointUrl: "http://unconsented-send-msg.example.com/v1",
        });

        expect(result).toMatchObject({
            success: false,
            error: "CONSENT_REQUIRED",
            origin: "http://unconsented-send-msg.example.com",
        });
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("send-message succeeds for a non-localhost endpoint after consent is given", async () => {
        // Grant consent for this unique origin.
        const consentHandler = ipcHandlers.get("ai-chat-consent");
        if (!consentHandler) throw new Error("ai-chat-consent not registered");
        await consentHandler(null, "http://consented-send-msg.example.com");

        const handler = ipcHandlers.get("ai-chat-send-message");
        if (!handler) throw new Error("ai-chat-send-message not registered");

        await handler(null, {
            ...BASE_PAYLOAD,
            endpointUrl: "http://consented-send-msg.example.com/v1",
        });

        expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    // -------------------------------------------------------------------------
    // ai-chat-cancel
    // -------------------------------------------------------------------------

    it("cancel calls session.cancel()", async () => {
        const handler = ipcHandlers.get("ai-chat-cancel");
        if (!handler) throw new Error("ai-chat-cancel not registered");

        await handler();

        expect(mockCancel).toHaveBeenCalledOnce();
    });

    // -------------------------------------------------------------------------
    // ai-chat-pick-directory
    // -------------------------------------------------------------------------

    it("pick-directory returns null when mainWindow is not set", async () => {
        // mainWindow is null — set in beforeEach via setMainWindow(null).
        const handler = ipcHandlers.get("ai-chat-pick-directory");
        if (!handler) throw new Error("ai-chat-pick-directory not registered");

        expect(await handler()).toBeNull();
        expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    });

    it("pick-directory returns null when the dialog is cancelled", async () => {
        const mockWindow = { webContents: { send: vi.fn() } };
        setMainWindow(
            mockWindow as unknown as import("electron").BrowserWindow,
        );
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: true,
            filePaths: [],
        });

        const handler = ipcHandlers.get("ai-chat-pick-directory");
        if (!handler) throw new Error("ai-chat-pick-directory not registered");

        expect(await handler()).toBeNull();
    });

    it("pick-directory returns null when no paths are returned by the dialog", async () => {
        const mockWindow = { webContents: { send: vi.fn() } };
        setMainWindow(
            mockWindow as unknown as import("electron").BrowserWindow,
        );
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: false,
            filePaths: [],
        });

        const handler = ipcHandlers.get("ai-chat-pick-directory");
        if (!handler) throw new Error("ai-chat-pick-directory not registered");

        expect(await handler()).toBeNull();
    });

    it("pick-directory returns the selected path when the user picks a directory", async () => {
        const mockWindow = { webContents: { send: vi.fn() } };
        setMainWindow(
            mockWindow as unknown as import("electron").BrowserWindow,
        );
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: false,
            filePaths: ["/home/user/bam-data"],
        });

        const handler = ipcHandlers.get("ai-chat-pick-directory");
        if (!handler) throw new Error("ai-chat-pick-directory not registered");

        expect(await handler()).toBe("/home/user/bam-data");
    });

    // -------------------------------------------------------------------------
    // ai-chat-consent
    // -------------------------------------------------------------------------

    it("consent records the origin so subsequent requests are allowed through", async () => {
        const consentHandler = ipcHandlers.get("ai-chat-consent");
        if (!consentHandler) throw new Error("ai-chat-consent not registered");
        await consentHandler(null, "http://verify-consent-test.example.com");

        // Verify consent took effect: send-message should reach session.sendMessage
        // rather than short-circuiting with CONSENT_REQUIRED.
        const sendHandler = ipcHandlers.get("ai-chat-send-message");
        if (!sendHandler)
            throw new Error("ai-chat-send-message not registered");
        await sendHandler(null, {
            ...BASE_PAYLOAD,
            endpointUrl: "http://verify-consent-test.example.com/v1",
        });

        expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    // -------------------------------------------------------------------------
    // ai-chat-get-system-prompt — validation failure path
    // -------------------------------------------------------------------------

    it("get-system-prompt returns a validation error for an out-of-range config value", async () => {
        // temperature > 2 triggers a configError in validateGetSystemPrompt.
        const handler = ipcHandlers.get("ai-chat-get-system-prompt");
        if (!handler)
            throw new Error("ai-chat-get-system-prompt not registered");

        const result = await handler(null, {
            config: { temperature: 5 },
        });

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining("temperature"),
        });
    });
});
