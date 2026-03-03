// AI Chat mode logic for nanalogue-gui.
// Manages IPC handlers for the LLM-powered BAM analysis chat interface.

import { type BrowserWindow, dialog, ipcMain } from "electron";
import {
    validateGetSystemPrompt,
    validateListModels,
    validateSendMessage,
} from "../lib/ai-chat-ipc-validation";
import { ChatSession } from "../lib/chat-session";
import type { AiChatEvent } from "../lib/chat-types";
import { fetchModels } from "../lib/model-listing";
import { deriveMaxOutputBytes } from "../lib/monty-sandbox";
import { buildSandboxPrompt } from "../lib/sandbox-prompt";
import { loadSystemAppend } from "../lib/system-append";

let mainWindow: BrowserWindow | null = null;

/** Shared session state for the current chat. */
const session = new ChatSession();

/** Set of acknowledged non-localhost endpoint origins (memory-only). */
const endpointConsent = new Set<string>();

/**
 * The allowedDir for which SYSTEM_APPEND.md is being (or has been) loaded.
 * Updated synchronously before the async read begins so that concurrent
 * callers for the same dir share a single Promise rather than racing.
 */
let cachedSystemAppendDir: string | undefined;

/**
 * Pending or resolved Promise for the SYSTEM_APPEND.md load.
 * Stored as a Promise (not a resolved value) so that if two sends arrive
 * while a read is still in-flight, both await the same operation and
 * loadSystemAppend() is never called twice for the same directory.
 */
let cachedSystemAppendPromise: Promise<string | undefined> | undefined;

/**
 * Returns the SYSTEM_APPEND.md content for the given directory.
 *
 * The Promise is stored immediately (before awaiting) so any concurrent
 * call for the same dir awaits the same read rather than starting a new
 * one. The cache is invalidated by clearSystemAppendCache() on session
 * reset, or automatically when allowedDir changes.
 *
 * @param allowedDir - Absolute path to the analysis directory.
 * @returns The file content, or undefined if absent or blocked.
 */
function getCachedSystemAppend(
    allowedDir: string,
): Promise<string | undefined> {
    if (cachedSystemAppendDir !== allowedDir) {
        cachedSystemAppendDir = allowedDir;
        // Assign the Promise synchronously before any await so concurrent
        // callers see it and share this single in-flight read.
        cachedSystemAppendPromise = loadSystemAppend(allowedDir);
    }
    // cachedSystemAppendPromise is always defined here: either it was just
    // assigned above, or it was set on a previous call for the same dir.
    return cachedSystemAppendPromise as Promise<string | undefined>;
}

/**
 * Returns the cached SYSTEM_APPEND.md promise if the cache is warm for the
 * given directory, otherwise undefined.
 *
 * Does not populate the cache — safe to call from preview handlers that
 * must not affect session state.
 *
 * @param allowedDir - Absolute path to the analysis directory.
 * @returns The in-flight or resolved promise if cached, otherwise undefined.
 */
function peekSystemAppendCache(
    allowedDir: string,
): Promise<string | undefined> | undefined {
    return cachedSystemAppendDir === allowedDir
        ? cachedSystemAppendPromise
        : undefined;
}

/**
 * Clears the SYSTEM_APPEND.md cache so the next session re-reads the file.
 * Called whenever the session is reset (New Chat or Go Back).
 */
function clearSystemAppendCache(): void {
    cachedSystemAppendDir = undefined;
    cachedSystemAppendPromise = undefined;
}

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
         * Queries the endpoint for available models using the provider-appropriate API.
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

            return fetchModels(endpointUrl, apiKey);
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

            const appendSystemPrompt = await getCachedSystemAppend(allowedDir);
            return session.sendMessage({
                endpointUrl,
                apiKey,
                model,
                message,
                allowedDir,
                config,
                emitEvent,
                appendSystemPrompt,
            });
        },
    );

    ipcMain.handle(
        "ai-chat-cancel",
        /**
         * Cancels the current in-flight LLM/sandbox request.
         */
        () => {
            session.cancel();
        },
    );

    ipcMain.handle(
        "ai-chat-new-chat",
        /**
         * Resets conversation state without losing connection settings.
         * Also clears the SYSTEM_APPEND.md cache so the next session
         * re-reads the file (the user may have edited it between sessions).
         */
        () => {
            session.reset();
            clearSystemAppendCache();
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
         * Also clears the SYSTEM_APPEND.md cache so the next session
         * re-reads the file (the user may have edited it between sessions).
         */
        () => {
            session.reset();
            clearSystemAppendCache();
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
         * Reads SYSTEM_APPEND.md directly (bypassing the session cache) so
         * that previewing the prompt never freezes stale content into the
         * cache before the first message is sent. The send-message handler
         * maintains its own cache independently.
         * The dynamic facts block is not included (it changes each turn).
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
            const { config, allowedDir } = validation.data;
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
            // If the session cache is already warm (first message has been
            // sent), use the cached value so the preview matches exactly what
            // the LLM is receiving. If the cache is cold (pre-session), read
            // directly without populating the cache — so preview cannot prime
            // it with stale content before the first send.
            const appendContent = allowedDir
                ? await (peekSystemAppendCache(allowedDir) ??
                      loadSystemAppend(allowedDir))
                : undefined;
            const prompt = appendContent
                ? `${sandboxPrompt}\n\n${appendContent}`
                : sandboxPrompt;
            return { success: true, prompt };
        },
    );
}
