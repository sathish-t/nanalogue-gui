// Regression tests for async work completing after AI Chat session resets.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
    AiChatEvent,
    AiChatSendMessageResult,
} from "../../lib/chat-types";

/** Shape of the mock preload API used by the renderer module. */
interface MockApi {
    /** Query endpoint models. */
    aiChatListModels: ReturnType<typeof vi.fn>;
    /** Send a message. */
    aiChatSendMessage: ReturnType<typeof vi.fn>;
    /** Cancel the current message. */
    aiChatCancel: ReturnType<typeof vi.fn>;
    /** Reset the current chat. */
    aiChatNewChat: ReturnType<typeof vi.fn>;
    /** Pick an analysis directory. */
    aiChatPickDirectory: ReturnType<typeof vi.fn>;
    /** Leave AI Chat. */
    aiChatGoBack: ReturnType<typeof vi.fn>;
    /** Record endpoint consent. */
    aiChatConsent: ReturnType<typeof vi.fn>;
    /** Build a system-prompt preview. */
    aiChatGetSystemPrompt: ReturnType<typeof vi.fn>;
    /** Register the event listener. */
    onAiChatEvent: ReturnType<typeof vi.fn>;
}

/** Loads the AI Chat document into jsdom. */
function loadHtml(): void {
    const path = join(import.meta.dirname, "ai-chat.html");
    document.documentElement.innerHTML = readFileSync(path, "utf-8");
}

/** Waits for pending promise continuations. */
async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Sets the fields required to send a message.
 *
 * @param endpoint - Endpoint URL to enter.
 * @param message - User message to enter.
 */
function setSendFields(endpoint: string, message: string): void {
    (document.getElementById("input-endpoint") as HTMLInputElement).value =
        endpoint;
    (document.getElementById("input-dir") as HTMLInputElement).value =
        "/tmp/bam";
    (document.getElementById("input-model") as HTMLInputElement).value =
        "model-a";
    (document.getElementById("input-message") as HTMLInputElement).value =
        message;
}

/**
 * Clicks a button and waits for its async handler.
 *
 * @param id - ID of the button to click.
 */
async function click(id: string): Promise<void> {
    (document.getElementById(id) as HTMLButtonElement).click();
    await flushMicrotasks();
}

describe("AI Chat reset races", () => {
    let api: MockApi;
    let emitAiChatEvent: (event: AiChatEvent) => void;

    beforeEach(async () => {
        vi.resetModules();
        loadHtml();
        for (const id of ["consent-dialog", "system-prompt-dialog"]) {
            const dialog = document.getElementById(id) as HTMLDialogElement;
            dialog.showModal = vi.fn();
            dialog.close = vi.fn();
        }
        api = {
            aiChatListModels: vi.fn(),
            aiChatSendMessage: vi.fn(),
            aiChatCancel: vi.fn(),
            aiChatNewChat: vi.fn().mockResolvedValue(undefined),
            aiChatPickDirectory: vi.fn(),
            aiChatGoBack: vi.fn().mockResolvedValue(undefined),
            aiChatConsent: vi.fn().mockResolvedValue(undefined),
            aiChatGetSystemPrompt: vi.fn(),
            onAiChatEvent: vi.fn(
                (listener: (event: AiChatEvent) => void): (() => void) => {
                    emitAiChatEvent = listener;
                    return () => {};
                },
            ),
        };
        (
            window as unknown as { /** Mock preload bridge. */ api: MockApi }
        ).api = api;
        await import("./ai-chat");
    });

    afterEach(() => {
        document.documentElement.innerHTML = "";
    });

    it("keeps a new first-send snapshot when an old send finishes", async () => {
        let resolveOld!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveOld = resolve;
                }),
            )
            .mockResolvedValueOnce({
                success: false,
                reason: "consent_required",
                error: "CONSENT_REQUIRED",
                origin: "https://api.example.com",
            })
            .mockResolvedValueOnce({ success: true, text: "current response" });

        setSendFields("https://api.example.com/v1", "old message");
        await click("btn-send");
        await click("btn-new-chat");

        const onlyAppend = document.getElementById(
            "opt-only-system-append",
        ) as HTMLInputElement;
        onlyAppend.checked = true;
        onlyAppend.dispatchEvent(new Event("change"));
        (
            document.getElementById("opt-max-code-rounds") as HTMLInputElement
        ).value = "17";
        setSendFields("https://api.example.com/v1", "current message");
        await click("btn-send");

        resolveOld({ success: true, text: "stale response" });
        await flushMicrotasks();
        api.aiChatGetSystemPrompt.mockResolvedValueOnce({
            success: true,
            prompt: "Standalone prompt",
        });
        await click("btn-view-system-prompt");
        expect(api.aiChatGetSystemPrompt).toHaveBeenLastCalledWith(
            expect.objectContaining({
                onlySystemAppend: true,
                config: expect.objectContaining({ maxCodeRounds: 17 }),
            }),
        );

        await click("btn-consent-accept");
        expect(api.aiChatSendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                onlySystemAppend: true,
                config: expect.objectContaining({ maxCodeRounds: 17 }),
            }),
        );
    });

    it("discards a late send response after Go Back", async () => {
        let resolveSend!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSend = resolve;
            }),
        );
        setSendFields("http://localhost:11434/v1", "hello");
        await click("btn-send");
        await click("btn-back");
        resolveSend({ success: true, text: "stale response" });
        await flushMicrotasks();

        expect(
            document.getElementById("chat-messages")?.textContent,
        ).not.toContain("stale response");
    });

    it("adds and clears a pending user message only after turn_start", async () => {
        let resolveSend!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSend = resolve;
            }),
        );
        setSendFields("http://localhost:11434/v1", "hello");

        await click("btn-send");

        const input = document.getElementById(
            "input-message",
        ) as HTMLInputElement;
        const messages = document.getElementById(
            "chat-messages",
        ) as HTMLDivElement;
        expect(input.value).toBe("hello");
        expect(messages.textContent).not.toContain("hello");

        emitAiChatEvent({ type: "turn_start" });
        emitAiChatEvent({ type: "turn_start" });

        expect(input.value).toBe("");
        expect(messages.textContent?.match(/hello/g)).toHaveLength(1);

        resolveSend({ success: true, text: "done" });
        await flushMicrotasks();
    });

    it("keeps the draft and ignores turn_start after preflight cancellation", async () => {
        let resolveSend!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSend = resolve;
            }),
        );
        setSendFields("http://localhost:11434/v1", "retry me");

        await click("btn-send");
        await click("btn-cancel");
        emitAiChatEvent({ type: "turn_start" });

        expect(
            (document.getElementById("input-message") as HTMLInputElement)
                .value,
        ).toBe("retry me");
        expect(
            document.getElementById("chat-messages")?.textContent,
        ).not.toContain("retry me");

        resolveSend({
            success: false,
            reason: "cancelled",
            error: "Cancelled",
        });
        await flushMicrotasks();
    });

    it("keeps an immediate retry isolated from a cancelled send result", async () => {
        let resolveCancelledSend!: (result: AiChatSendMessageResult) => void;
        let resolveRetry!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveCancelledSend = resolve;
                }),
            )
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveRetry = resolve;
                }),
            );
        setSendFields("http://localhost:11434/v1", "cancelled draft");

        await click("btn-send");
        await click("btn-cancel");
        (
            document.getElementById("opt-max-code-rounds") as HTMLInputElement
        ).value = "17";
        (document.getElementById("input-message") as HTMLInputElement).value =
            "retry draft";
        await click("btn-send");

        resolveCancelledSend({
            success: false,
            reason: "cancelled",
            error: "Cancelled",
        });
        await flushMicrotasks();

        expect(
            document.getElementById("chat-messages")?.textContent,
        ).not.toContain("Request cancelled");
        expect(
            (document.getElementById("input-message") as HTMLInputElement)
                .value,
        ).toBe("retry draft");
        expect(
            (document.getElementById("btn-cancel") as HTMLButtonElement)
                .classList,
        ).not.toContain("hidden");
        expect(api.aiChatSendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                message: "retry draft",
                config: expect.objectContaining({ maxCodeRounds: 17 }),
            }),
        );

        emitAiChatEvent({ type: "turn_start" });
        resolveRetry({ success: true, text: "retry response" });
        await flushMicrotasks();
        expect(document.getElementById("chat-messages")?.textContent).toContain(
            "retry draft",
        );
    });

    it("does not grant consent or resend after cancellation", async () => {
        api.aiChatSendMessage.mockResolvedValueOnce({
            success: false,
            reason: "consent_required",
            error: "CONSENT_REQUIRED",
            origin: "https://api.example.com",
        });
        setSendFields("https://api.example.com/v1", "cancel consent");

        await click("btn-send");
        await click("btn-cancel");
        await click("btn-consent-accept");

        expect(api.aiChatConsent).not.toHaveBeenCalled();
        expect(api.aiChatSendMessage).toHaveBeenCalledOnce();
        expect(
            (document.getElementById("input-message") as HTMLInputElement)
                .value,
        ).toBe("cancel consent");
    });

    it("keeps an accepted turn and config locked when cancelled", async () => {
        let resolveSend!: (result: AiChatSendMessageResult) => void;
        api.aiChatSendMessage.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSend = resolve;
            }),
        );
        setSendFields("http://localhost:11434/v1", "accepted message");

        await click("btn-send");
        emitAiChatEvent({ type: "turn_start" });
        await click("btn-cancel");

        expect(
            (document.getElementById("input-message") as HTMLInputElement)
                .value,
        ).toBe("");
        expect(document.getElementById("chat-messages")?.textContent).toContain(
            "accepted message",
        );
        expect(
            (document.getElementById("input-dir") as HTMLInputElement).disabled,
        ).toBe(true);

        resolveSend({
            success: false,
            reason: "cancelled",
            error: "Cancelled",
            promptSnapshotAccepted: true,
        });
        await flushMicrotasks();
        expect(
            (document.getElementById("input-dir") as HTMLInputElement).disabled,
        ).toBe(true);
    });

    it("does not accept a pending user message after New Chat", async () => {
        api.aiChatSendMessage.mockReturnValueOnce(
            new Promise<AiChatSendMessageResult>(() => {}),
        );
        setSendFields("http://localhost:11434/v1", "old draft");

        await click("btn-send");
        await click("btn-new-chat");
        emitAiChatEvent({ type: "turn_start" });

        expect(
            document.getElementById("chat-messages")?.textContent,
        ).not.toContain("old draft");
    });

    it("adds one user bubble when consent retry reaches turn_start", async () => {
        api.aiChatSendMessage
            .mockResolvedValueOnce({
                success: false,
                reason: "consent_required",
                error: "CONSENT_REQUIRED",
                origin: "https://api.example.com",
            })
            .mockImplementationOnce(async () => {
                emitAiChatEvent({ type: "turn_start" });
                return { success: true, text: "done" };
            });
        setSendFields("https://api.example.com/v1", "consented message");

        await click("btn-send");
        await click("btn-consent-accept");

        expect(api.aiChatSendMessage).toHaveBeenCalledTimes(2);
        expect(
            document
                .getElementById("chat-messages")
                ?.textContent?.match(/consented message/g),
        ).toHaveLength(1);
        expect(
            (document.getElementById("input-message") as HTMLInputElement)
                .value,
        ).toBe("");
    });

    it("locks config after accepted preflight followed by an LLM failure", async () => {
        api.aiChatSendMessage.mockResolvedValueOnce({
            success: false,
            reason: "error",
            error: "connection refused",
            isTimeout: false,
            promptSnapshotAccepted: true,
        });
        setSendFields("http://localhost:11434/v1", "hello");

        await click("btn-send");

        expect(
            (document.getElementById("input-dir") as HTMLInputElement).disabled,
        ).toBe(true);
        expect(
            (document.getElementById("btn-browse") as HTMLButtonElement)
                .disabled,
        ).toBe(true);

        await click("btn-new-chat");
        expect(
            (document.getElementById("input-dir") as HTMLInputElement).disabled,
        ).toBe(false);
    });

    it.each([
        "btn-new-chat",
        "btn-back",
    ])("invalidates a pending prompt preview on %s", async (resetButtonId) => {
        let resolvePreview!: (result: {
            /** Whether the preview succeeded. */
            success: true;
            /** Generated prompt. */
            prompt: string;
        }) => void;
        api.aiChatGetSystemPrompt.mockReturnValueOnce(
            new Promise((resolve) => {
                resolvePreview = resolve;
            }),
        );
        await click("btn-view-system-prompt");
        await click(resetButtonId);
        resolvePreview({ success: true, prompt: "stale prompt" });
        await flushMicrotasks();

        expect(
            document.getElementById("system-prompt-pre")?.textContent,
        ).not.toBe("stale prompt");
    });
});
