// AI Chat renderer script for nanalogue-gui.
// Handles the chat UI, configuration panel, code panel, and IPC communication.

import { CONFIG_FIELD_SPECS } from "../../lib/ai-chat-shared-constants";

/** Result returned by mode launch IPC handlers. */
interface LaunchResult {
    /** Whether the launch succeeded. */
    success: boolean;
    /** The reason for failure. */
    reason?: string;
}

/** Response from the send-message IPC handler. */
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

/** Response from the list-models IPC handler. */
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

/** Event sent from main process during AI Chat turns. */
interface AiChatEvent {
    /** The event type discriminator. */
    type: string;
    /** Python code for tool_execution_start events. */
    code?: string;
    /** Sandbox result for tool_execution_end events. */
    result?: unknown;
    /** Assistant text for turn_end events. */
    text?: string;
    /** Code steps for turn_end events. */
    steps?: Array<{
        /** The Python code that was executed. */
        code: string;
        /** The sandbox execution result. */
        result: unknown;
    }>;
    /** Error message for turn_error events. */
    error?: string;
    /** Whether the error was a timeout. */
    isTimeout?: boolean;
}

/** Preload API exposed to the AI Chat renderer. */
interface AiChatApi {
    /** Launch the AI Chat mode. */
    launchAiChat: () => Promise<LaunchResult>;
    /** Query endpoint for available models. */
    aiChatListModels: (payload: {
        /** The base URL of the LLM endpoint. */
        endpointUrl: string;
        /** The API key for authentication. */
        apiKey: string;
    }) => Promise<ListModelsResult>;
    /** Send a user message. */
    aiChatSendMessage: (payload: {
        /** The base URL of the LLM endpoint. */
        endpointUrl: string;
        /** The API key for authentication. */
        apiKey: string;
        /** The model identifier to use. */
        model: string;
        /** The user's chat message text. */
        message: string;
        /** The directory the sandbox may access. */
        allowedDir: string;
        /** Advanced configuration options. */
        config: Record<string, unknown>;
    }) => Promise<SendMessageResult>;
    /** Cancel the current request. */
    aiChatCancel: () => Promise<void>;
    /** Reset conversation state. */
    aiChatNewChat: () => Promise<void>;
    /** Open directory picker. */
    aiChatPickDirectory: () => Promise<string | null>;
    /** Navigate back to landing. */
    aiChatGoBack: () => Promise<void>;
    /** Record endpoint consent. */
    aiChatConsent: (origin: string) => Promise<void>;
    /** Register event listener. */
    onAiChatEvent: (callback: (event: AiChatEvent) => void) => () => void;
}

/** The preload API instance. */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: AiChatApi;
    }
).api;

// DOM references
const inputDir = document.getElementById("input-dir") as HTMLInputElement;
const btnBrowse = document.getElementById("btn-browse") as HTMLButtonElement;
const inputEndpoint = document.getElementById(
    "input-endpoint",
) as HTMLInputElement;
const inputApiKey = document.getElementById(
    "input-api-key",
) as HTMLInputElement;
const inputModel = document.getElementById("input-model") as HTMLInputElement;
const modelDropdown = document.getElementById(
    "model-dropdown",
) as HTMLDivElement;
const btnFetchModels = document.getElementById(
    "btn-fetch-models",
) as HTMLButtonElement;
const fetchStatus = document.getElementById("fetch-status") as HTMLDivElement;
const connectionStatus = document.getElementById(
    "connection-status",
) as HTMLDivElement;
const btnAdvanced = document.getElementById(
    "btn-advanced",
) as HTMLButtonElement;
const chatMessages = document.getElementById("chat-messages") as HTMLDivElement;
const chatSpinner = document.getElementById("chat-spinner") as HTMLDivElement;
const spinnerText = document.getElementById("spinner-text") as HTMLSpanElement;
const codePanelToggle = document.getElementById(
    "code-panel-toggle",
) as HTMLButtonElement;
const codePanelContent = document.getElementById(
    "code-panel-content",
) as HTMLDivElement;
const codeDisplay = document.getElementById("code-display") as HTMLPreElement;
const codePageIndicator = document.getElementById(
    "code-page-indicator",
) as HTMLSpanElement;
const btnCodePrev = document.getElementById(
    "btn-code-prev",
) as HTMLButtonElement;
const btnCodeNext = document.getElementById(
    "btn-code-next",
) as HTMLButtonElement;
const inputMessage = document.getElementById(
    "input-message",
) as HTMLInputElement;
const btnSend = document.getElementById("btn-send") as HTMLButtonElement;
const btnCancel = document.getElementById("btn-cancel") as HTMLButtonElement;
const btnNewChat = document.getElementById("btn-new-chat") as HTMLButtonElement;
const btnBack = document.getElementById("btn-back") as HTMLButtonElement;
const advancedDialog = document.getElementById(
    "advanced-dialog",
) as HTMLDialogElement;
const consentDialog = document.getElementById(
    "consent-dialog",
) as HTMLDialogElement;
const optContextWindow = document.getElementById(
    "opt-context-window",
) as HTMLInputElement;
const optMaxRetries = document.getElementById(
    "opt-max-retries",
) as HTMLInputElement;
const optTimeout = document.getElementById("opt-timeout") as HTMLInputElement;
const optMaxReadInfo = document.getElementById(
    "opt-max-read-info",
) as HTMLInputElement;
const optMaxBamMods = document.getElementById(
    "opt-max-bam-mods",
) as HTMLInputElement;
const optMaxWindowReads = document.getElementById(
    "opt-max-window-reads",
) as HTMLInputElement;
const optMaxSeqTable = document.getElementById(
    "opt-max-seq-table",
) as HTMLInputElement;
const optMaxCodeRounds = document.getElementById(
    "opt-max-code-rounds",
) as HTMLInputElement;
const optTemperature = document.getElementById(
    "opt-temperature",
) as HTMLInputElement;

/** Stored code steps for the code panel pagination. */
let codeSteps: Array<{
    /** The Python code that was executed. */
    code: string;
    /** The sandbox execution result. */
    result: unknown;
}> = [];
/** Current page index in the code panel. */
let currentCodePage = 0;
/** Whether a chat has been started (locks advanced options). */
let chatStarted = false;
/** Pending consent resolver (for the consent dialog flow). */
let pendingConsentResolve: ((accepted: boolean) => void) | null = null;
/** Fetched model IDs for filtering in the custom dropdown. */
let fetchedModels: string[] = [];
/** Origin of the last successfully connected endpoint, or null. */
let connectedOrigin: string | null = null;

/** Hostnames that count as localhost. */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Updates the connection status indicator based on the endpoint URL
 * and whether the last request succeeded.
 *
 * @param connected - Whether we have a confirmed connection.
 */
function updateConnectionStatus(connected: boolean): void {
    const raw = inputEndpoint.value.trim();
    if (!raw) {
        connectionStatus.textContent = "";
        connectionStatus.className = "status-indicator";
        return;
    }

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        connectionStatus.textContent = "";
        connectionStatus.className = "status-indicator";
        return;
    }

    const isLocal = LOCALHOST_HOSTS.has(url.hostname);
    const isHttps = url.protocol === "https:";

    let text: string;
    let cssClass: string;

    if (isLocal) {
        text = connected ? "\u25cf Connected (local)" : "Local endpoint";
        cssClass = connected ? "status-connected" : "status-idle";
    } else if (isHttps) {
        text = connected
            ? "\u25cf Connected (remote, HTTPS)"
            : "Remote endpoint (HTTPS)";
        cssClass = connected ? "status-connected" : "status-idle";
    } else {
        text = connected
            ? "\u25cf Connected (remote, HTTP) \u2014 unencrypted"
            : "Remote endpoint (HTTP) \u2014 unencrypted";
        cssClass = "status-warning";
    }

    connectionStatus.textContent = text;
    connectionStatus.className = `status-indicator ${cssClass}`;
}

/**
 * Populates the custom model dropdown with matching options.
 *
 * @param filter - The text to filter model names by.
 */
function showModelDropdown(filter: string): void {
    const lowerFilter = filter.toLowerCase();
    const matches = fetchedModels.filter((m) =>
        m.toLowerCase().includes(lowerFilter),
    );
    if (matches.length === 0) {
        modelDropdown.classList.add("hidden");
        return;
    }
    modelDropdown.innerHTML = "";
    for (const modelId of matches) {
        const option = document.createElement("div");
        option.className = "model-option";
        option.textContent = modelId;
        option.addEventListener("mousedown", (e) => {
            e.preventDefault();
            inputModel.value = modelId;
            modelDropdown.classList.add("hidden");
        });
        modelDropdown.appendChild(option);
    }
    modelDropdown.classList.remove("hidden");
}

/**
 * Hides the custom model dropdown.
 */
function hideModelDropdown(): void {
    modelDropdown.classList.add("hidden");
}

/**
 * Appends a message bubble to the chat area.
 *
 * @param role - The message role: "user", "assistant", or "error".
 * @param text - The message text content.
 */
function appendMessage(role: string, text: string): void {
    const div = document.createElement("div");
    div.className = `chat-msg-${role}`;

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent =
        role === "user" ? "You" : role === "error" ? "Error" : "Assistant";
    div.appendChild(label);

    const content = document.createElement("div");
    content.className = "msg-text";
    content.textContent = text;
    div.appendChild(content);

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Shows or hides the loading spinner with a message.
 *
 * @param show - Whether to show the spinner.
 * @param text - The spinner text message.
 */
function setSpinner(show: boolean, text?: string): void {
    chatSpinner.classList.toggle("hidden", !show);
    if (text) spinnerText.textContent = text;
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
}

/**
 * Updates the code panel to show a specific page.
 *
 * @param page - The zero-based page index to display.
 */
function showCodePage(page: number): void {
    if (codeSteps.length === 0) {
        codeDisplay.textContent = "No code executed yet.";
        codePageIndicator.textContent = "0 / 0";
        return;
    }
    const clampedPage = Math.max(0, Math.min(page, codeSteps.length - 1));
    currentCodePage = clampedPage;
    codeDisplay.textContent = codeSteps[clampedPage].code;
    codePageIndicator.textContent = `${clampedPage + 1} / ${codeSteps.length}`;
}

/**
 * Returns the current advanced options config values.
 *
 * @returns A config object with the current field values.
 */
function getConfig(): Record<string, unknown> {
    /**
     * Parses a numeric input value, returning the fallback if the value is
     * not a finite number. Unlike `Number(x) || fallback`, this preserves 0.
     *
     * @param raw - The raw string from the input element.
     * @param fallback - The fallback value from CONFIG_FIELD_SPECS.
     * @returns The parsed number or the fallback.
     */
    const parse = (raw: string, fallback: number): number => {
        const v = Number(raw);
        return Number.isFinite(v) ? v : fallback;
    };
    return {
        contextWindowTokens: parse(
            optContextWindow.value,
            CONFIG_FIELD_SPECS.contextWindowTokens.fallback,
        ),
        maxRetries: parse(
            optMaxRetries.value,
            CONFIG_FIELD_SPECS.maxRetries.fallback,
        ),
        timeoutSeconds: parse(
            optTimeout.value,
            CONFIG_FIELD_SPECS.timeoutSeconds.fallback,
        ),
        maxRecordsReadInfo: parse(
            optMaxReadInfo.value,
            CONFIG_FIELD_SPECS.maxRecordsReadInfo.fallback,
        ),
        maxRecordsBamMods: parse(
            optMaxBamMods.value,
            CONFIG_FIELD_SPECS.maxRecordsBamMods.fallback,
        ),
        maxRecordsWindowReads: parse(
            optMaxWindowReads.value,
            CONFIG_FIELD_SPECS.maxRecordsWindowReads.fallback,
        ),
        maxRecordsSeqTable: parse(
            optMaxSeqTable.value,
            CONFIG_FIELD_SPECS.maxRecordsSeqTable.fallback,
        ),
        maxCodeRounds: parse(
            optMaxCodeRounds.value,
            CONFIG_FIELD_SPECS.maxCodeRounds.fallback,
        ),
        // Temperature is optional — empty string means undefined (omit from request)
        temperature: optTemperature.value.trim()
            ? Number.parseFloat(optTemperature.value)
            : undefined,
    };
}

/**
 * Locks the advanced options fields after the first message.
 */
function lockAdvancedOptions(): void {
    chatStarted = true;
    optContextWindow.disabled = true;
    optMaxRetries.disabled = true;
    optTimeout.disabled = true;
    optMaxReadInfo.disabled = true;
    optMaxBamMods.disabled = true;
    optMaxWindowReads.disabled = true;
    optMaxSeqTable.disabled = true;
    optMaxCodeRounds.disabled = true;
    optTemperature.disabled = true;
}

/**
 * Unlocks the advanced options fields (for New Chat).
 */
function unlockAdvancedOptions(): void {
    chatStarted = false;
    optContextWindow.disabled = false;
    optMaxRetries.disabled = false;
    optTimeout.disabled = false;
    optMaxReadInfo.disabled = false;
    optMaxBamMods.disabled = false;
    optMaxWindowReads.disabled = false;
    optMaxSeqTable.disabled = false;
    optMaxCodeRounds.disabled = false;
    optTemperature.disabled = false;
}

/**
 * Resets the advanced options to default values.
 */
function resetDefaults(): void {
    optContextWindow.value = String(
        CONFIG_FIELD_SPECS.contextWindowTokens.fallback,
    );
    optMaxRetries.value = String(CONFIG_FIELD_SPECS.maxRetries.fallback);
    optTimeout.value = String(CONFIG_FIELD_SPECS.timeoutSeconds.fallback);
    optMaxReadInfo.value = String(
        CONFIG_FIELD_SPECS.maxRecordsReadInfo.fallback,
    );
    optMaxBamMods.value = String(CONFIG_FIELD_SPECS.maxRecordsBamMods.fallback);
    optMaxWindowReads.value = String(
        CONFIG_FIELD_SPECS.maxRecordsWindowReads.fallback,
    );
    optMaxSeqTable.value = String(
        CONFIG_FIELD_SPECS.maxRecordsSeqTable.fallback,
    );
    optMaxCodeRounds.value = String(CONFIG_FIELD_SPECS.maxCodeRounds.fallback);
    optTemperature.value = "";
}

/**
 * Validates that required config fields are filled before sending.
 *
 * @returns An error message string, or null if valid.
 */
function validateConfig(): string | null {
    if (!inputDir.value) return "Please select a BAM directory.";
    if (!inputEndpoint.value) return "Please enter an endpoint URL.";
    if (!inputModel.value) return "Please enter a model name.";
    return null;
}

// Browse button — open directory picker
btnBrowse.addEventListener("click", async () => {
    const dir = await api.aiChatPickDirectory();
    if (dir) inputDir.value = dir;
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
    if (!inputEndpoint.value) {
        fetchStatus.textContent = "Enter an endpoint URL first.";
        return;
    }
    fetchStatus.textContent = "Fetching models...";
    btnFetchModels.disabled = true;

    const requestedEndpoint = inputEndpoint.value.trim();
    let result = await api.aiChatListModels({
        endpointUrl: inputEndpoint.value,
        apiKey: inputApiKey.value,
    });

    // Handle consent-required for non-localhost endpoints
    if (
        !result.success &&
        result.error === "CONSENT_REQUIRED" &&
        result.origin
    ) {
        const consentOrigin = document.getElementById(
            "consent-origin",
        ) as HTMLElement;
        consentOrigin.textContent = result.origin;
        const accepted = await new Promise<boolean>((resolve) => {
            pendingConsentResolve = resolve;
            consentDialog.showModal();
        });
        if (accepted) {
            await api.aiChatConsent(result.origin);
            result = await api.aiChatListModels({
                endpointUrl: inputEndpoint.value,
                apiKey: inputApiKey.value,
            });
        } else {
            btnFetchModels.disabled = false;
            fetchStatus.textContent = "Endpoint consent denied.";
            return;
        }
    }

    btnFetchModels.disabled = false;

    // Only update connection status if endpoint hasn't changed during request
    const endpointStillMatches =
        inputEndpoint.value.trim() === requestedEndpoint;

    if (result.success && result.models) {
        fetchedModels = result.models;
        showModelDropdown(inputModel.value);
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

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        fetchStatus.textContent = "";
    }, 8000);
});

// Model input — filter and show/hide the custom dropdown
inputModel.addEventListener("input", () => {
    if (fetchedModels.length > 0) {
        showModelDropdown(inputModel.value);
    }
});

// Show dropdown on focus if models are available
inputModel.addEventListener("focus", () => {
    if (fetchedModels.length > 0) {
        showModelDropdown(inputModel.value);
    }
});

// Hide dropdown on blur (mousedown on options fires before blur)
inputModel.addEventListener("blur", () => {
    hideModelDropdown();
});

/**
 * Sends a message to the AI Chat backend and handles the response.
 * Separated from the click handler to allow consent-retry without re-appending
 * the user bubble.
 *
 * @param message - The user's chat message text.
 * @param showBubble - Whether to append the user message as a chat bubble.
 */
async function sendUserMessage(
    message: string,
    showBubble: boolean,
): Promise<void> {
    if (showBubble) {
        appendMessage("user", message);
    }
    setProcessing(true);
    setSpinner(true, "Waiting for LLM...");

    const requestedEndpoint = inputEndpoint.value.trim();
    const result = await api.aiChatSendMessage({
        endpointUrl: inputEndpoint.value,
        apiKey: inputApiKey.value,
        model: inputModel.value,
        message,
        allowedDir: inputDir.value,
        config: getConfig(),
    });

    setProcessing(false);
    setSpinner(false);

    // Only update connection status if endpoint hasn't changed during request
    const endpointStillMatches =
        inputEndpoint.value.trim() === requestedEndpoint;

    if (result.success) {
        if (result.text) {
            appendMessage("assistant", result.text);
        }
        if (result.steps) {
            codeSteps.push(...result.steps);
            showCodePage(codeSteps.length - 1);
        }
        if (endpointStillMatches) {
            try {
                connectedOrigin = new URL(requestedEndpoint).origin;
            } catch {
                connectedOrigin = null;
            }
            updateConnectionStatus(true);
        }
    } else if (result.error === "CONSENT_REQUIRED" && result.origin) {
        // Show consent dialog
        const consentOrigin = document.getElementById(
            "consent-origin",
        ) as HTMLElement;
        consentOrigin.textContent = result.origin;
        const accepted = await new Promise<boolean>((resolve) => {
            pendingConsentResolve = resolve;
            consentDialog.showModal();
        });
        if (accepted) {
            await api.aiChatConsent(result.origin);
            // Retry without re-appending the user bubble
            await sendUserMessage(message, false);
        } else {
            appendMessage(
                "error",
                "Connection cancelled — endpoint consent denied.",
            );
        }
    } else if (result.error === "Cancelled") {
        appendMessage("error", "Request cancelled.");
    } else {
        appendMessage("error", result.error ?? "Unknown error occurred.");
        if (endpointStillMatches) {
            connectedOrigin = null;
            updateConnectionStatus(false);
        }
    }
}

// Send button — send user message
btnSend.addEventListener("click", async () => {
    const message = inputMessage.value.trim();
    if (!message) return;

    const validationError = validateConfig();
    if (validationError) {
        appendMessage("error", validationError);
        return;
    }

    // Lock advanced options on first message
    if (!chatStarted) lockAdvancedOptions();

    inputMessage.value = "";
    await sendUserMessage(message, true);
});

// Enter key sends the message
inputMessage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        btnSend.click();
    }
});

// Cancel button — abort current request
btnCancel.addEventListener("click", async () => {
    await api.aiChatCancel();
    setProcessing(false);
    setSpinner(false);
});

// New Chat button — reset conversation
btnNewChat.addEventListener("click", async () => {
    await api.aiChatNewChat();
    chatMessages.innerHTML = "";
    codeSteps = [];
    currentCodePage = 0;
    showCodePage(0);
    setSpinner(false);
    setProcessing(false);
    unlockAdvancedOptions();
});

// Back button — return to landing page
btnBack.addEventListener("click", async () => {
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
    showCodePage(currentCodePage - 1);
});

btnCodeNext.addEventListener("click", () => {
    showCodePage(currentCodePage + 1);
});

// Advanced Options dialog
btnAdvanced.addEventListener("click", () => {
    advancedDialog.showModal();
});

document.getElementById("btn-close-advanced")?.addEventListener("click", () => {
    advancedDialog.close();
});

document.getElementById("btn-defaults")?.addEventListener("click", () => {
    if (!chatStarted) resetDefaults();
});

/**
 * Atomically captures and clears the consent resolver to prevent double invocation
 * from both the button click and the dialog close event.
 *
 * @param accepted - Whether the user accepted the consent prompt.
 */
function resolveConsent(accepted: boolean): void {
    const resolver = pendingConsentResolve;
    if (!resolver) return;
    pendingConsentResolve = null;
    resolver(accepted);
}

// Consent dialog buttons
document.getElementById("btn-consent-accept")?.addEventListener("click", () => {
    consentDialog.close();
    resolveConsent(true);
});

document.getElementById("btn-consent-cancel")?.addEventListener("click", () => {
    consentDialog.close();
    resolveConsent(false);
});

// Handle Esc key or backdrop click dismissing the consent dialog
consentDialog.addEventListener("close", () => {
    resolveConsent(false);
});

// Listen for AI Chat events from the main process
api.onAiChatEvent((event: AiChatEvent) => {
    switch (event.type) {
        case "turn_start":
            setSpinner(true, "Processing...");
            break;
        case "llm_request_start":
            setSpinner(true, "Waiting for LLM...");
            break;
        case "tool_execution_start":
            setSpinner(true, "Running sandbox code...");
            break;
        case "tool_execution_end":
            setSpinner(true, "Processing...");
            break;
        case "llm_request_end":
            break;
        case "turn_end":
            setSpinner(false);
            setProcessing(false);
            break;
        case "turn_error":
            setSpinner(false);
            setProcessing(false);
            break;
        case "turn_cancelled":
            setSpinner(false);
            setProcessing(false);
            break;
    }
});
