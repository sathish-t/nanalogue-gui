// AI Chat renderer bootstrap.
// Wires the chat UI, configuration panel, code panel, and IPC communication.

import {
    MAX_MESSAGE_BYTES,
    NOMINAL_BYTES_PER_TOKEN,
} from "../../lib/ai-chat-constants";
import type { AiChatEvent, StepInfo } from "../../lib/chat-types";
import { getUtf8ByteLength } from "../../lib/chat-user-input-parsing";
import { applyFontSize } from "../shared/apply-font-size";
import {
    applyConfigBounds,
    getConfig,
    lockSessionConfig,
    resetDefaults,
    unlockSessionConfig,
    validateAdvancedConfig,
    validateConfig,
    validateConnectionConfig,
} from "./ai-chat-config";
import { initConsentDialog, requestConsent } from "./ai-chat-consent";
import { getAiChatElements } from "./ai-chat-elements";
import type { AiChatApi } from "./ai-chat-types";
import {
    appendMessage,
    hideModelDropdown,
    setSpinner,
    showCodePage,
    showModelDropdown,
    updateConnectionStatus,
} from "./ai-chat-ui";

const {
    advancedDialog,
    btnAdvanced,
    btnBack,
    btnBrowse,
    btnCancel,
    btnCloseAdvanced,
    btnCloseSystemPrompt,
    btnCodeNext,
    btnCodePrev,
    btnCopyCode,
    btnCopySystemPrompt,
    btnDefaults,
    btnFetchModels,
    btnNewChat,
    btnSend,
    btnViewSystemPrompt,
    chatMessages,
    codePanelContent,
    codePanelToggle,
    fetchStatus,
    inputApiKey,
    inputDir,
    inputEndpoint,
    inputMessage,
    inputModel,
    modelDropdown,
    optOnlySystemAppend,
    systemPromptConfigNote,
    systemPromptDialog,
    systemPromptPre,
    systemPromptTokenEstimate,
} = getAiChatElements();

applyFontSize();

/** The preload API instance. */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: AiChatApi;
    }
).api;

/** Stored code steps for the code panel pagination. */
let codeSteps: StepInfo[] = [];
/** Current page index in the code panel. */
let currentCodePage = 0;
/** Whether a chat has been started (locks advanced options). */
let chatStarted = false;
/**
 * Config snapshot captured when the first send is initiated.
 * Used so the system-prompt preview reflects the config actually sent to the
 * backend while prompt preflight is pending and chatStarted is still false.
 */
let sessionLockedConfig: Record<string, unknown> | null = null;
/**
 * Snapshot of the SYSTEM_APPEND-only checkbox captured with sessionLockedConfig.
 * Keeps the prompt preview consistent with the prompt actually sent while the
 * first request is in flight.
 */
let sessionLockedOnlySystemAppend: boolean | null = null;
/** Send request that owns the current first-send config snapshots. */
let sessionSnapshotOwner: object | null = null;
/** Fetched model IDs for filtering in the custom dropdown. */
let fetchedModels: string[] = [];
/** Origin of the last successfully connected endpoint, or null. */
let connectedOrigin: string | null = null;
/** Generation counter incremented on New Chat to discard stale async responses. */
let chatGeneration = 0;
/** Generation counter incremented on each prompt preview open to discard stale IPC responses. */
let systemPromptGeneration = 0;
/** Whether the Advanced Options checkbox uses SYSTEM_APPEND.md as the base prompt. */
let onlySystemAppend = false;
/** Renderer-owned send spanning preflight, consent, and result handling. */
let activeRendererTurn:
    | {
          /** Identity shared by the initial send and a consent retry. */
          requestToken: object;
          /** Message to show after backend preflight succeeds. */
          message: string;
          /** Renderer session in which the message was submitted. */
          generation: number;
          /** Prompt mode submitted with this turn. */
          onlySystemAppend: boolean;
          /** Whether turn_start has already accepted this message. */
          accepted: boolean;
      }
    | undefined;

/**
 * Checks whether a request still owns renderer send state.
 *
 * @param requestToken - Request identity to check.
 * @param generation - Renderer session in which the request started.
 * @returns True while the request may update renderer state.
 */
function ownsActiveRendererTurn(
    requestToken: object,
    generation: number,
): boolean {
    return (
        activeRendererTurn?.requestToken === requestToken &&
        generation === chatGeneration
    );
}

/** Invalidates the active send and releases an unaccepted config snapshot. */
function invalidateActiveRendererTurn(): void {
    const requestToken = activeRendererTurn?.requestToken;
    activeRendererTurn = undefined;
    if (
        !chatStarted &&
        requestToken !== undefined &&
        sessionSnapshotOwner === requestToken
    ) {
        sessionLockedConfig = null;
        sessionLockedOnlySystemAppend = null;
        sessionSnapshotOwner = null;
    }
}

/**
 * Temporarily disables or re-enables the config fields during in-flight requests.
 * Skipped when chatStarted is true because those fields are permanently locked.
 *
 * @param disabled - Whether to disable the fields.
 */
function setConfigFieldsDisabled(disabled: boolean): void {
    if (chatStarted) return;
    inputDir.disabled = disabled;
    btnBrowse.disabled = disabled;
    inputEndpoint.disabled = disabled;
    inputApiKey.disabled = disabled;
    inputModel.disabled = disabled;
    btnFetchModels.disabled = disabled;
    optOnlySystemAppend.disabled = disabled;
    if (btnDefaults) btnDefaults.disabled = disabled;
}

/**
 * Enables or disables the send/cancel buttons during processing.
 *
 * @param processing - Whether a request is in flight.
 */
function setProcessing(processing: boolean): void {
    btnSend.classList.toggle("hidden", processing);
    btnCancel.classList.toggle("hidden", !processing);
    inputMessage.disabled = processing;
    btnSend.disabled = processing;
    setConfigFieldsDisabled(processing);
    if (processing) {
        hideModelDropdown();
    }
}

// Browse button — open directory picker
btnBrowse.addEventListener("click", async () => {
    const dir = await api.aiChatPickDirectory();
    if (dir) {
        inputDir.value = dir;
        if (optOnlySystemAppend.checked) {
            optOnlySystemAppend.checked = false;
            onlySystemAppend = false;
        }
    }
});

// Endpoint input — update connection status and reset if origin changed
inputEndpoint.addEventListener("input", () => {
    let originUnchanged = false;
    try {
        const newOrigin = new URL(inputEndpoint.value.trim()).origin;
        if (connectedOrigin && newOrigin === connectedOrigin) {
            originUnchanged = true;
        } else if (connectedOrigin && newOrigin !== connectedOrigin) {
            connectedOrigin = null;
        }
    } catch {
        connectedOrigin = null;
    }
    updateConnectionStatus(originUnchanged && connectedOrigin !== null);
});

// Fetch Models button — query endpoint for model list
btnFetchModels.addEventListener("click", async () => {
    const validationError = validateConnectionConfig();
    if (validationError) {
        window.alert(validationError);
        return;
    }
    fetchStatus.textContent = "Fetching models...";
    btnFetchModels.disabled = true;
    setConfigFieldsDisabled(true);
    hideModelDropdown();

    const requestedEndpoint = inputEndpoint.value.trim();
    const generation = chatGeneration;
    try {
        let result = await api.aiChatListModels({
            endpointUrl: inputEndpoint.value,
            apiKey: inputApiKey.value,
        });

        if (!result.success && result.reason === "consent_required") {
            const accepted = await requestConsent(result.origin);
            if (accepted) {
                if (generation !== chatGeneration) return;
                await api.aiChatConsent(result.origin);
                result = await api.aiChatListModels({
                    endpointUrl: inputEndpoint.value,
                    apiKey: inputApiKey.value,
                });
            } else {
                if (generation === chatGeneration) {
                    fetchStatus.textContent = "Endpoint consent denied.";
                    setTimeout(() => {
                        fetchStatus.textContent = "";
                    }, 8000);
                }
                return;
            }
        }

        if (generation !== chatGeneration) return;

        const endpointStillMatches =
            inputEndpoint.value.trim() === requestedEndpoint;

        if (result.success) {
            fetchedModels = result.models;
            showModelDropdown(fetchedModels, inputModel.value, chatStarted);
            fetchStatus.textContent = `Found ${result.models.length} model(s).`;
            if (endpointStillMatches) {
                try {
                    connectedOrigin = new URL(requestedEndpoint).origin;
                } catch {
                    connectedOrigin = null;
                }
                updateConnectionStatus(true);
            }
        } else {
            fetchStatus.textContent = result.error ?? "Unknown error";
            if (endpointStillMatches) {
                connectedOrigin = null;
                updateConnectionStatus(false);
            }
        }

        setTimeout(() => {
            fetchStatus.textContent = "";
        }, 8000);
    } catch (err) {
        if (generation === chatGeneration) {
            const msg = err instanceof Error ? err.message : String(err);
            fetchStatus.textContent = `Unexpected error: ${msg}`;
        }
    } finally {
        if (generation === chatGeneration && !chatStarted) {
            btnFetchModels.disabled = false;
            setConfigFieldsDisabled(false);
        }
    }
});

// Model input — filter and show/hide the custom dropdown
inputModel.addEventListener("input", () => {
    if (fetchedModels.length > 0) {
        showModelDropdown(fetchedModels, inputModel.value, chatStarted);
    }
});

// Show dropdown on focus if models are available
inputModel.addEventListener("focus", () => {
    if (fetchedModels.length > 0) {
        showModelDropdown(fetchedModels, inputModel.value, chatStarted);
    }
});

// Hide dropdown on blur (mousedown on options fires before blur)
inputModel.addEventListener("blur", () => {
    hideModelDropdown();
});

/**
 * Sends a message to the AI Chat backend and handles the response.
 * Separated from the click handler to allow consent retry with the same pending
 * user turn.
 *
 * @param message - The user's chat message text.
 * @param requestToken - Identity shared by an initial send and its consent retry.
 */
async function sendUserMessage(
    message: string,
    requestToken: object = {},
): Promise<void> {
    if (!chatStarted && sessionLockedConfig === null) {
        sessionLockedConfig = getConfig();
        sessionLockedOnlySystemAppend = onlySystemAppend;
        sessionSnapshotOwner = requestToken;
    }
    setProcessing(true);
    setSpinner(true, "Waiting for LLM...");

    const requestedEndpoint = inputEndpoint.value.trim();
    const generation = chatGeneration;
    const requestedOnlySystemAppend =
        sessionLockedOnlySystemAppend ?? onlySystemAppend;
    try {
        const result = await api.aiChatSendMessage({
            endpointUrl: inputEndpoint.value,
            apiKey: inputApiKey.value,
            model: inputModel.value,
            message,
            allowedDir: inputDir.value,
            config: getConfig(),
            onlySystemAppend: requestedOnlySystemAppend,
        });

        if (!ownsActiveRendererTurn(requestToken, generation)) return;

        const endpointStillMatches =
            inputEndpoint.value.trim() === requestedEndpoint;

        if (
            !chatStarted &&
            (result.success ||
                ("promptSnapshotAccepted" in result &&
                    result.promptSnapshotAccepted === true))
        ) {
            onlySystemAppend = requestedOnlySystemAppend;
            optOnlySystemAppend.checked = requestedOnlySystemAppend;
            chatStarted = true;
            lockSessionConfig();
            hideModelDropdown();
        }

        if (result.success) {
            if (result.text) {
                appendMessage("assistant", result.text);
            }
            if (result.steps) {
                codeSteps.push(...result.steps);
                currentCodePage = showCodePage(codeSteps, codeSteps.length - 1);
            }
            if (endpointStillMatches) {
                try {
                    connectedOrigin = new URL(requestedEndpoint).origin;
                } catch {
                    connectedOrigin = null;
                }
                updateConnectionStatus(true);
            }
        } else if (result.reason === "consent_required") {
            const accepted = await requestConsent(result.origin);
            if (!ownsActiveRendererTurn(requestToken, generation)) return;
            if (accepted) {
                await api.aiChatConsent(result.origin);
                if (!ownsActiveRendererTurn(requestToken, generation)) return;
                await sendUserMessage(message, requestToken);
            } else {
                appendMessage(
                    "error",
                    "Connection cancelled — endpoint consent denied.",
                );
            }
        } else if (result.reason === "cancelled") {
            appendMessage("error", "Request cancelled.");
        } else {
            const errorMsg = result.isTimeout
                ? "LLM response timed out (i.e. a message from the LLM took too much time to arrive)"
                : (result.error ?? "Unknown error occurred.");
            if (result.inputError) {
                window.alert(errorMsg);
            } else {
                appendMessage("error", errorMsg);
            }
            if (endpointStillMatches) {
                connectedOrigin = null;
                updateConnectionStatus(false);
            }
        }
    } catch (err) {
        if (ownsActiveRendererTurn(requestToken, generation)) {
            const msg = err instanceof Error ? err.message : String(err);
            appendMessage("error", `Unexpected error: ${msg}`);
        }
    } finally {
        if (ownsActiveRendererTurn(requestToken, generation)) {
            if (!chatStarted && sessionSnapshotOwner === requestToken) {
                sessionLockedConfig = null;
                sessionLockedOnlySystemAppend = null;
                sessionSnapshotOwner = null;
            }
            activeRendererTurn = undefined;
            setProcessing(false);
            setSpinner(false);
        }
    }
}

// Send button — send user message
btnSend.addEventListener("click", async () => {
    const message = inputMessage.value.trim();
    if (!message) return;
    if (getUtf8ByteLength(message) > MAX_MESSAGE_BYTES) {
        window.alert("Message exceeds the 1 MiB limit.");
        return;
    }

    const validationError = validateConfig();
    if (validationError) {
        window.alert(validationError);
        return;
    }

    const requestToken = {};
    activeRendererTurn = {
        requestToken,
        message,
        generation: chatGeneration,
        onlySystemAppend,
        accepted: false,
    };
    await sendUserMessage(message, requestToken);
});

// Enter key sends the message
inputMessage.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        btnSend.click();
    }
});

// Cancel button — abort current request
btnCancel.addEventListener("click", async () => {
    invalidateActiveRendererTurn();
    await api.aiChatCancel();
    setProcessing(false);
    setSpinner(false);
});

// New Chat button — full reset of conversation and connection state
btnNewChat.addEventListener("click", async () => {
    chatGeneration++;
    systemPromptGeneration++;
    sessionLockedConfig = null;
    sessionLockedOnlySystemAppend = null;
    sessionSnapshotOwner = null;
    activeRendererTurn = undefined;

    await api.aiChatNewChat();
    chatMessages.innerHTML = "";
    codeSteps = [];
    currentCodePage = showCodePage(codeSteps, 0);
    setSpinner(false);
    chatStarted = false;
    setProcessing(false);
    unlockSessionConfig();

    fetchedModels = [];
    connectedOrigin = null;
    fetchStatus.textContent = "";
    modelDropdown.innerHTML = "";
    hideModelDropdown();
    updateConnectionStatus(false);
});

// Back button — return to landing page
btnBack.addEventListener("click", async () => {
    chatGeneration++;
    systemPromptGeneration++;
    sessionLockedConfig = null;
    sessionLockedOnlySystemAppend = null;
    sessionSnapshotOwner = null;
    activeRendererTurn = undefined;
    await api.aiChatGoBack();
});

// Code panel toggle
codePanelToggle.addEventListener("click", () => {
    const isHidden = codePanelContent.classList.toggle("hidden");
    codePanelToggle.textContent = isHidden
        ? "▶ Sandboxed Code (for advanced users)"
        : "▼ Sandboxed Code (for advanced users)";
});

// Code panel pagination
btnCodePrev.addEventListener("click", () => {
    currentCodePage = showCodePage(codeSteps, currentCodePage - 1);
});

btnCodeNext.addEventListener("click", () => {
    currentCodePage = showCodePage(codeSteps, currentCodePage + 1);
});

// Copy code button — copies the currently displayed code block to the clipboard
btnCopyCode.addEventListener("click", () => {
    const code = codeSteps[currentCodePage]?.code;
    if (!code) return;
    navigator.clipboard
        .writeText(code)
        .then(() => {
            btnCopyCode.textContent = "Copied!";
            setTimeout(() => {
                btnCopyCode.textContent = "Copy";
            }, 1500);
        })
        .catch(() => {
            btnCopyCode.textContent = "Failed";
            setTimeout(() => {
                btnCopyCode.textContent = "Copy";
            }, 1500);
        });
});

// Advanced Options dialog
btnAdvanced.addEventListener("click", () => {
    advancedDialog.showModal();
});

// SYSTEM_APPEND-only checkbox — file contents are validated by the send handler.
optOnlySystemAppend.addEventListener("change", () => {
    if (!optOnlySystemAppend.checked) {
        onlySystemAppend = false;
        return;
    }
    if (!inputDir.value) {
        window.alert("Please select a BAM directory first.");
        optOnlySystemAppend.checked = false;
        onlySystemAppend = false;
        return;
    }
    onlySystemAppend = true;
});

btnCloseAdvanced?.addEventListener("click", () => {
    const validationError = validateAdvancedConfig();
    if (validationError) {
        window.alert(validationError);
        return;
    }
    advancedDialog.close();
});

btnDefaults?.addEventListener("click", () => {
    if (!chatStarted) {
        resetDefaults();
        onlySystemAppend = false;
    }
});

// View System Prompt button — fetch and display the static system prompt
btnViewSystemPrompt.addEventListener("click", async () => {
    const validationError = validateAdvancedConfig();
    if (validationError) {
        window.alert(validationError);
        return;
    }
    const generation = ++systemPromptGeneration;
    systemPromptPre.textContent = "Loading…";
    systemPromptTokenEstimate.textContent = "";
    // Once the first send has been initiated, sessionLockedConfig holds the
    // config that was (or will be) sent to the LLM. Use it so the preview
    // matches the actual session prompt even before chatStarted is set.
    const promptModeOnlySystemAppend =
        sessionLockedOnlySystemAppend ?? onlySystemAppend;
    systemPromptConfigNote.textContent =
        sessionLockedConfig !== null
            ? promptModeOnlySystemAppend
                ? "Using SYSTEM_APPEND.md as the full prompt for this session."
                : "Based on the settings for this session."
            : promptModeOnlySystemAppend
              ? "Using SYSTEM_APPEND.md as the full prompt."
              : "Based on your current Advanced Options settings.";
    systemPromptDialog.showModal();

    const result = await api.aiChatGetSystemPrompt({
        config: sessionLockedConfig ?? getConfig(),
        allowedDir: inputDir.value || undefined,
        onlySystemAppend: promptModeOnlySystemAppend,
    });
    if (generation !== systemPromptGeneration) return;
    if (result.success) {
        systemPromptPre.textContent = result.prompt;
        const byteLength = new TextEncoder().encode(result.prompt).byteLength;
        const roughTokens = Math.round(byteLength / NOMINAL_BYTES_PER_TOKEN);
        systemPromptTokenEstimate.textContent = `~${roughTokens.toLocaleString()} tokens (rough)`;
    } else {
        window.alert(result.error);
        systemPromptPre.textContent = `Error: ${result.error}`;
        systemPromptTokenEstimate.textContent = "";
    }
});

// Copy system prompt button — copies the full prompt text to the clipboard
btnCopySystemPrompt.addEventListener("click", () => {
    const text = systemPromptPre.textContent ?? "";
    navigator.clipboard
        .writeText(text)
        .then(() => {
            btnCopySystemPrompt.textContent = "Copied!";
            setTimeout(() => {
                btnCopySystemPrompt.textContent = "Copy";
            }, 1500);
        })
        .catch(() => {
            btnCopySystemPrompt.textContent = "Failed";
            setTimeout(() => {
                btnCopySystemPrompt.textContent = "Copy";
            }, 1500);
        });
});

// Close system prompt dialog button
btnCloseSystemPrompt.addEventListener("click", () => {
    systemPromptDialog.close();
});

// Listen for AI Chat events from the main process
api.onAiChatEvent((event: AiChatEvent) => {
    switch (event.type) {
        case "turn_start":
            if (
                activeRendererTurn !== undefined &&
                activeRendererTurn.generation === chatGeneration &&
                !activeRendererTurn.accepted
            ) {
                appendMessage("user", activeRendererTurn.message);
                inputMessage.value = "";
                activeRendererTurn.accepted = true;
                if (!chatStarted) {
                    onlySystemAppend = activeRendererTurn.onlySystemAppend;
                    optOnlySystemAppend.checked = onlySystemAppend;
                    chatStarted = true;
                    lockSessionConfig();
                    hideModelDropdown();
                }
            }
            setSpinner(true, "Processing...");
            break;
        case "llm_request_start":
            setSpinner(true, "Waiting for LLM...");
            break;
        case "code_execution_start":
            setSpinner(true, "Running sandbox code...");
            break;
        case "code_execution_end":
            setSpinner(true, "Processing...");
            break;
        case "llm_request_end":
            break;
        case "turn_end":
        case "turn_error":
        case "turn_cancelled":
            setSpinner(false);
            setProcessing(false);
            break;
    }
});

initConsentDialog();
applyConfigBounds();
resetDefaults();
currentCodePage = showCodePage(codeSteps, 0);
