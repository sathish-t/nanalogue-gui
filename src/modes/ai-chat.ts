// AI Chat mode logic for nanalogue-gui.
// Manages IPC handlers for the LLM-powered BAM analysis chat interface.

import { type BrowserWindow, dialog, ipcMain } from "electron";
import {
    validateGetSystemPrompt,
    validateListModels,
    validateSendMessage,
} from "../lib/ai-chat-ipc-validation";
import { validateAnalysisDirectory } from "../lib/chat-filesystem-input-checks";
import { ChatSession } from "../lib/chat-session";
import type {
    AiChatEvent,
    AiChatListModelsResult,
    AiChatSendMessageResult,
} from "../lib/chat-types";
import { fetchModels } from "../lib/model-listing";
import { deriveMaxOutputBytes } from "../lib/monty-sandbox-helpers";
import {
    buildCompleteSystemPrompt,
    buildSandboxPrompt,
    joinSystemPromptParts,
} from "../lib/sandbox-prompt";
import { loadSystemAppend } from "../lib/system-append";

let mainWindow: BrowserWindow | null = null;

/** Shared session state for the current chat. */
const session = new ChatSession();

/** Set of acknowledged non-localhost endpoint origins (memory-only). */
const endpointConsent = new Set<string>();

/** Immutable system prompt inputs captured by the first accepted send. */
interface SessionPromptSnapshot {
    /** Canonical directory from which SYSTEM_APPEND.md was read. */
    allowedDir: string;
    /** Captured file content, or undefined when the file was absent. */
    appendSystemPrompt: string | undefined;
    /** Whether SYSTEM_APPEND.md is the complete system prompt. */
    onlySystemAppend: boolean;
}

/** Committed prompt snapshot for the active session, if a send was accepted. */
let sessionPromptSnapshot: SessionPromptSnapshot | undefined;

/** Identity of the one send currently allowed to mutate session state. */
interface ActiveAiChatSend {
    /** Session generation captured when the send started. */
    sessionGeneration: number;
    /** Cancellation generation captured when the send started. */
    cancellationGeneration: number;
}

/** Monotonic identity incremented whenever the current chat session is reset. */
let aiChatSessionGeneration = 0;

/** Monotonic identity incremented whenever the current request is cancelled. */
let aiChatCancellationGeneration = 0;

/** Active send token used to reject overlapping send-message requests. */
let activeAiChatSend: ActiveAiChatSend | undefined;

/**
 * Checks whether a send lost ownership through cancel, reset, or replacement.
 *
 * @param sendToken - Identity captured before the send's first asynchronous preflight.
 * @returns Whether the request must stop before performing more work.
 */
function isAiChatSendCancelled(sendToken: ActiveAiChatSend): boolean {
    return (
        activeAiChatSend !== sendToken ||
        sendToken.sessionGeneration !== aiChatSessionGeneration ||
        sendToken.cancellationGeneration !== aiChatCancellationGeneration
    );
}

/**
 * Sets the main browser window reference used by IPC handlers.
 *
 * @param window - The main BrowserWindow instance, or null to clear.
 */
export function setAiChatMainWindow(window: BrowserWindow | null): void {
    mainWindow = window;
}

/**
 * Emits a typed event to the renderer process via IPC.
 *
 * @param event - The AI Chat event to send.
 */
function emitEvent(event: AiChatEvent): void {
    mainWindow?.webContents.send("ai-chat-event", event);
}

/**
 * Checks whether an endpoint URL is localhost.
 *
 * @param url - The URL string to check.
 * @returns True if the URL points to localhost.
 */
function isLocalhost(url: string): boolean {
    const parsed = new URL(url);
    return (
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname === "[::1]"
    );
}

/**
 * Returns the origin (scheme + host + port) of a URL.
 *
 * @param url - The URL string.
 * @returns The origin string.
 */
function getOrigin(url: string): string {
    return new URL(url).origin;
}

/**
 * Validates and handles an AI Chat model-listing request.
 *
 * @param payload - Untrusted renderer payload.
 * @returns The canonical model-listing IPC result.
 */
async function listAiChatModels(
    payload: unknown,
): Promise<AiChatListModelsResult> {
    const validation = validateListModels(payload);
    if (!validation.valid) {
        return {
            success: false,
            reason: "error",
            error: validation.error,
        };
    }
    const { endpointUrl, apiKey } = validation.data;

    if (!isLocalhost(endpointUrl)) {
        const origin = getOrigin(endpointUrl);
        if (!endpointConsent.has(origin)) {
            return {
                success: false,
                reason: "consent_required",
                error: "CONSENT_REQUIRED",
                origin,
            };
        }
    }

    return fetchModels(endpointUrl, apiKey);
}

/**
 * Validates and handles an AI Chat send-message request.
 *
 * @param payload - Untrusted renderer payload.
 * @returns The canonical send-message IPC result.
 */
async function sendAiChatMessage(
    payload: unknown,
): Promise<AiChatSendMessageResult> {
    const validation = validateSendMessage(payload);
    if (!validation.valid) {
        return {
            success: false,
            reason: "error",
            error: validation.error,
            isTimeout: false,
            inputError: true,
        };
    }
    const {
        endpointUrl,
        apiKey,
        model,
        message,
        allowedDir: allowedDirInput,
        config,
        onlySystemAppend,
    } = validation.data;

    if (activeAiChatSend !== undefined) {
        return {
            success: false,
            reason: "error",
            error: "Another AI chat request is already in progress",
            isTimeout: false,
        };
    }

    const sendToken: ActiveAiChatSend = {
        sessionGeneration: aiChatSessionGeneration,
        cancellationGeneration: aiChatCancellationGeneration,
    };
    activeAiChatSend = sendToken;

    try {
        let allowedDir: string;
        try {
            allowedDir = await validateAnalysisDirectory(
                allowedDirInput,
                process.cwd(),
            );
        } catch (error) {
            if (isAiChatSendCancelled(sendToken)) {
                return {
                    success: false,
                    reason: "cancelled",
                    error: "Cancelled",
                };
            }
            return {
                success: false,
                reason: "error",
                error: error instanceof Error ? error.message : String(error),
                isTimeout: false,
                inputError: true,
            };
        }
        if (isAiChatSendCancelled(sendToken)) {
            return {
                success: false,
                reason: "cancelled",
                error: "Cancelled",
            };
        }

        if (
            sessionPromptSnapshot !== undefined &&
            allowedDir !== sessionPromptSnapshot.allowedDir
        ) {
            return {
                success: false,
                reason: "error",
                error: "Analysis directory cannot change during an active chat session",
                isTimeout: false,
                inputError: true,
            };
        }

        if (!isLocalhost(endpointUrl)) {
            const origin = getOrigin(endpointUrl);
            if (!endpointConsent.has(origin)) {
                return {
                    success: false,
                    reason: "consent_required",
                    error: "CONSENT_REQUIRED",
                    origin,
                };
            }
        }

        const requestedOnlySystemAppend = onlySystemAppend === true;
        if (
            sessionPromptSnapshot !== undefined &&
            sessionPromptSnapshot.onlySystemAppend !== requestedOnlySystemAppend
        ) {
            return {
                success: false,
                reason: "error",
                error: "System prompt mode cannot change during an active chat session",
                isTimeout: false,
                inputError: true,
            };
        }

        let appendSystemPrompt = sessionPromptSnapshot?.appendSystemPrompt;
        if (sessionPromptSnapshot === undefined) {
            try {
                appendSystemPrompt = await loadSystemAppend(allowedDir);
            } catch (error) {
                if (isAiChatSendCancelled(sendToken)) {
                    return {
                        success: false,
                        reason: "cancelled",
                        error: "Cancelled",
                    };
                }
                return {
                    success: false,
                    reason: "error",
                    error:
                        error instanceof Error ? error.message : String(error),
                    isTimeout: false,
                    inputError: true,
                };
            }
            if (isAiChatSendCancelled(sendToken)) {
                return {
                    success: false,
                    reason: "cancelled",
                    error: "Cancelled",
                };
            }
        }
        if (onlySystemAppend && appendSystemPrompt === undefined) {
            return {
                success: false,
                reason: "error",
                error: "SYSTEM_APPEND.md is required when only-system-append is enabled",
                isTimeout: false,
                inputError: true,
            };
        }

        const effectiveAppendSystemPrompt = onlySystemAppend
            ? undefined
            : appendSystemPrompt;
        const effectiveReplaceSystemPrompt = onlySystemAppend
            ? appendSystemPrompt
            : undefined;
        try {
            const maxOutputBytes = deriveMaxOutputBytes(
                config.contextWindowTokens,
            );
            buildCompleteSystemPrompt({
                config,
                maxOutputKB: Math.round(maxOutputBytes / 1024),
                appendSystemPrompt: effectiveAppendSystemPrompt,
                replaceSystemPrompt: effectiveReplaceSystemPrompt,
            });
        } catch (error) {
            return {
                success: false,
                reason: "error",
                error: error instanceof Error ? error.message : String(error),
                isTimeout: false,
                inputError: true,
            };
        }

        sessionPromptSnapshot ??= {
            allowedDir,
            appendSystemPrompt,
            onlySystemAppend: requestedOnlySystemAppend,
        };

        /**
         * Forwards progress only while this request still owns the active session.
         *
         * @param event - Progress event emitted by the chat session.
         */
        const emitRequestEvent = (event: AiChatEvent): void => {
            if (!isAiChatSendCancelled(sendToken)) {
                emitEvent(event);
            }
        };
        const result = await session.sendMessage({
            endpointUrl,
            apiKey,
            model,
            message,
            allowedDir,
            config,
            emitEvent: emitRequestEvent,
            appendSystemPrompt: effectiveAppendSystemPrompt,
            replaceSystemPrompt: effectiveReplaceSystemPrompt,
        });
        if (isAiChatSendCancelled(sendToken)) {
            return {
                success: false,
                reason: "cancelled",
                error: "Cancelled",
                promptSnapshotAccepted: true,
            };
        }
        return { ...result, promptSnapshotAccepted: true };
    } finally {
        if (activeAiChatSend === sendToken) {
            activeAiChatSend = undefined;
        }
    }
}

/**
 * Registers all IPC handlers for the AI Chat mode.
 */
export function registerAiChatIpcHandlers(): void {
    ipcMain.handle(
        "ai-chat-list-models",
        /**
         * Queries the endpoint for available models using the provider-appropriate API.
         *
         * @param _event - The IPC event (unused).
         * @param payload - The endpoint URL and API key.
         * @returns A list of model IDs or an error message.
         */
        async (_event, payload: unknown) => listAiChatModels(payload),
    );

    ipcMain.handle(
        "ai-chat-send-message",
        /**
         * Sends a user message through the orchestrator and returns the response.
         *
         * @param _event - The IPC event (unused).
         * @param payload - The message, endpoint, model, directory, and config.
         * @returns The assistant response with text and code steps.
         */
        async (_event, payload: unknown) => sendAiChatMessage(payload),
    );

    ipcMain.handle(
        "ai-chat-cancel",
        /**
         * Cancels the current in-flight LLM/sandbox request.
         */
        () => {
            aiChatCancellationGeneration += 1;
            activeAiChatSend = undefined;
            session.cancel();
        },
    );

    ipcMain.handle(
        "ai-chat-new-chat",
        /**
         * Resets conversation state without losing connection settings.
         * Also clears the SYSTEM_APPEND.md snapshot so the next session
         * re-reads the file (the user may have edited it between sessions).
         */
        () => {
            aiChatSessionGeneration += 1;
            activeAiChatSend = undefined;
            session.reset();
            sessionPromptSnapshot = undefined;
        },
    );

    ipcMain.handle(
        "ai-chat-pick-directory",
        /**
         * Opens a native directory picker for selecting the BAM analysis directory.
         *
         * @returns The selected directory path, or null if cancelled.
         */
        async () => {
            if (!mainWindow) return null;
            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select BAM analysis directory",
                properties: ["openDirectory"],
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            return result.filePaths[0];
        },
    );

    ipcMain.handle(
        "ai-chat-go-back",
        /**
         * Navigates back to the landing page from the AI Chat screen.
         * Also clears the SYSTEM_APPEND.md snapshot so the next session
         * re-reads the file (the user may have edited it between sessions).
         */
        () => {
            aiChatSessionGeneration += 1;
            activeAiChatSend = undefined;
            session.reset();
            sessionPromptSnapshot = undefined;
        },
    );

    ipcMain.handle(
        "ai-chat-consent",
        /**
         * Records user consent for a non-localhost endpoint origin.
         *
         * @param _event - The IPC event (unused).
         * @param origin - The endpoint origin string.
         */
        (_event, origin: string) => {
            endpointConsent.add(origin);
        },
    );

    ipcMain.handle(
        "ai-chat-get-system-prompt",
        /**
         * Builds and returns the effective system prompt for the given config.
         *
         * Reads SYSTEM_APPEND.md live before the first accepted message, then
         * uses the immutable conversation snapshot after a send is accepted.
         * Previewing never commits a snapshot itself.
         *
         * @param _event - The IPC event (unused).
         * @param payload - The config and optional allowedDir from the renderer.
         * @returns The effective system prompt string, or an error result.
         */
        async (_event, payload: unknown) => {
            const validation = validateGetSystemPrompt(payload);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const {
                config,
                allowedDir: allowedDirInput,
                onlySystemAppend,
            } = validation.data;
            let allowedDir: string | undefined;
            if (
                allowedDirInput !== undefined &&
                sessionPromptSnapshot === undefined
            ) {
                try {
                    allowedDir = await validateAnalysisDirectory(
                        allowedDirInput,
                        process.cwd(),
                    );
                } catch (error) {
                    return {
                        success: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
            }
            const requestedOnlySystemAppend = onlySystemAppend === true;
            if (
                sessionPromptSnapshot !== undefined &&
                sessionPromptSnapshot.onlySystemAppend !==
                    requestedOnlySystemAppend
            ) {
                return {
                    success: false,
                    error: "System prompt mode cannot change during an active chat session",
                };
            }
            const maxOutputBytes = deriveMaxOutputBytes(
                config.contextWindowTokens,
            );
            const maxOutputKB = Math.round(maxOutputBytes / 1024);
            const sandboxPrompt = buildSandboxPrompt({
                maxOutputKB,
                maxRecordsReadInfo: config.maxRecordsReadInfo,
                maxRecordsBamMods: config.maxRecordsBamMods,
                maxRecordsWindowReads: config.maxRecordsWindowReads,
                maxRecordsSeqTable: config.maxRecordsSeqTable,
                maxReadMB: config.maxReadMB,
                maxWriteMB: config.maxWriteMB,
                maxDurationSecs: config.maxDurationSecs,
            });
            // Use a committed snapshot after the first accepted send. Before
            // then, read independently so preview cannot publish or reuse a
            // pending send's provisional content.
            let appendContent: string | undefined;
            try {
                appendContent = sessionPromptSnapshot
                    ? sessionPromptSnapshot.appendSystemPrompt
                    : allowedDir
                      ? await loadSystemAppend(allowedDir)
                      : undefined;
            } catch (error) {
                return {
                    success: false,
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
            if (requestedOnlySystemAppend) {
                if (appendContent === undefined) {
                    return {
                        success: false,
                        error: "SYSTEM_APPEND.md is required when only-system-append is enabled",
                    };
                }
                // onlySystemAppend intentionally returns the append file as the full prompt.
                return { success: true, prompt: appendContent };
            }
            try {
                return {
                    success: true,
                    prompt: joinSystemPromptParts({
                        base: sandboxPrompt,
                        append: appendContent ?? "",
                    }),
                };
            } catch (error) {
                return {
                    success: false,
                    error:
                        error instanceof Error ? error.message : String(error),
                };
            }
        },
    );
}
