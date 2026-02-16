// AI Chat mode logic for nanalogue-gui.
// Manages IPC handlers for the LLM-powered BAM analysis chat interface.

import { type BrowserWindow, dialog, ipcMain } from "electron";
import { MODEL_LIST_TIMEOUT_MS } from "../lib/ai-chat-constants";
import {
    validateListModels,
    validateSendMessage,
} from "../lib/ai-chat-ipc-validation";
import { handleUserMessage } from "../lib/chat-orchestrator";
import type { AiChatEvent, Fact, HistoryEntry } from "../lib/chat-types";

let mainWindow: BrowserWindow | null = null;

/** Conversation history for the current session. */
let history: HistoryEntry[] = [];
/** Accumulated facts from successful tool results. */
let facts: Fact[] = [];
/** Monotonic request counter for stale response detection. */
let requestId = 0;
/** Abort controller for the current in-flight request. */
let currentAbortController: AbortController | null = null;
/** Per-turn dedup cache for tool call results. */
let dedupCache = new Map<string, string>();
/** Set of acknowledged non-localhost endpoint origins (memory-only). */
const endpointConsent = new Set<string>();

/**
 * Sets the main browser window reference used by IPC handlers.
 *
 * @param window - The main BrowserWindow instance, or null to clear.
 */
export function setMainWindow(window: BrowserWindow | null): void {
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
    try {
        const parsed = new URL(url);
        return (
            parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1" ||
            parsed.hostname === "::1" ||
            parsed.hostname === "[::1]"
        );
    } catch {
        return false;
    }
}

/**
 * Returns the origin (scheme + host + port) of a URL.
 *
 * @param url - The URL string.
 * @returns The origin string.
 */
function getOrigin(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return url;
    }
}

/**
 * Registers all IPC handlers for the AI Chat mode.
 */
export function registerIpcHandlers(): void {
    ipcMain.handle(
        "ai-chat-list-models",
        /**
         * Queries the endpoint for available models via GET /v1/models.
         *
         * @param _event - The IPC event (unused).
         * @param payload - The endpoint URL and API key.
         * @returns A list of model IDs or an error message.
         */
        async (_event, payload: unknown) => {
            const validation = validateListModels(payload);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const { endpointUrl, apiKey } = validation.data;

            // Require consent for non-localhost endpoints before sending requests
            if (!isLocalhost(endpointUrl)) {
                const origin = getOrigin(endpointUrl);
                if (!endpointConsent.has(origin)) {
                    return {
                        success: false,
                        error: "CONSENT_REQUIRED",
                        origin,
                    };
                }
            }

            try {
                const url = `${endpointUrl.replace(/\/+$/, "")}/models`;
                const headers: Record<string, string> = {
                    Accept: "application/json",
                };
                if (apiKey) {
                    headers.Authorization = `Bearer ${apiKey}`;
                }
                const response = await fetch(url, {
                    headers,
                    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
                });
                if (!response.ok) {
                    if (response.status === 404) {
                        return {
                            success: false,
                            error: "Endpoint does not support model listing — type a model name manually",
                        };
                    }
                    if (response.status === 401 || response.status === 403) {
                        return {
                            success: false,
                            error: "Authentication failed — check your API key",
                        };
                    }
                    return {
                        success: false,
                        error: `Unexpected response: ${response.status}`,
                    };
                }
                const body = (await response.json()) as {
                    /** The list of available models. */
                    data?: Array<{
                        /** The model identifier. */
                        id: string;
                    }>;
                };
                if (!body.data || !Array.isArray(body.data)) {
                    return {
                        success: false,
                        error: "Unexpected response from endpoint",
                    };
                }
                return {
                    success: true,
                    models: body.data.map(
                        (m: {
                            /** The model identifier. */
                            id: string;
                        }) => m.id,
                    ),
                };
            } catch (error) {
                if (error instanceof Error && error.name === "TimeoutError") {
                    return { success: false, error: "Request timed out" };
                }
                return {
                    success: false,
                    error: "Could not reach endpoint",
                };
            }
        },
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
        async (_event, payload: unknown) => {
            const validation = validateSendMessage(payload);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const { endpointUrl, apiKey, model, message, allowedDir, config } =
                validation.data;

            // Check endpoint consent for non-localhost
            if (!isLocalhost(endpointUrl)) {
                const origin = getOrigin(endpointUrl);
                if (!endpointConsent.has(origin)) {
                    return {
                        success: false,
                        error: "CONSENT_REQUIRED",
                        origin,
                    };
                }
            }

            // Increment requestId and create new abort controller
            requestId += 1;
            const thisRequestId = requestId;
            currentAbortController?.abort();
            currentAbortController = new AbortController();
            const localSignal = currentAbortController.signal;
            dedupCache = new Map();

            try {
                const result = await handleUserMessage({
                    message,
                    endpointUrl,
                    apiKey,
                    model,
                    allowedDir,
                    config,
                    emitEvent,
                    history,
                    facts,
                    signal: localSignal,
                    dedupCache,
                });

                // Check for cancellation or stale response. Cancel increments
                // requestId, so check the abort signal first to return the
                // correct "Cancelled" status instead of "Request superseded".
                if (localSignal.aborted) {
                    emitEvent({ type: "turn_cancelled" });
                    return { success: false, error: "Cancelled" };
                }
                if (thisRequestId !== requestId) {
                    return { success: false, error: "Request superseded" };
                }

                return {
                    success: true,
                    text: result.text,
                    steps: result.steps,
                };
            } catch (error) {
                if (localSignal.aborted) {
                    const isTimeout =
                        error instanceof Error &&
                        (error.name === "TimeoutError" ||
                            error.message.includes("timed out"));
                    if (!isTimeout) {
                        emitEvent({ type: "turn_cancelled" });
                        return { success: false, error: "Cancelled" };
                    }
                }
                if (thisRequestId !== requestId) {
                    return { success: false, error: "Request superseded" };
                }
                const isTimeout =
                    error instanceof Error &&
                    (error.name === "TimeoutError" ||
                        error.message.includes("timed out"));
                const errorMsg =
                    error instanceof Error ? error.message : String(error);
                emitEvent({
                    type: "turn_error",
                    error: errorMsg,
                    isTimeout,
                });
                return {
                    success: false,
                    error: errorMsg,
                    isTimeout,
                };
            }
        },
    );

    ipcMain.handle(
        "ai-chat-cancel",
        /**
         * Cancels the current in-flight LLM/sandbox request.
         */
        () => {
            requestId += 1;
            currentAbortController?.abort();
            currentAbortController = null;
        },
    );

    ipcMain.handle(
        "ai-chat-new-chat",
        /**
         * Resets conversation state without losing connection settings.
         */
        () => {
            history = [];
            facts = [];
            requestId += 1;
            currentAbortController?.abort();
            currentAbortController = null;
            dedupCache = new Map();
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
         */
        () => {
            // Reset state when leaving
            history = [];
            facts = [];
            requestId += 1;
            currentAbortController?.abort();
            currentAbortController = null;
            dedupCache = new Map();
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
}
