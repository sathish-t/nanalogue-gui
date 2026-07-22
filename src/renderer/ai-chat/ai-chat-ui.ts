// UI helpers for the AI Chat renderer.

import { getAiChatElements } from "./ai-chat-elements";
import type { CodeStep } from "./ai-chat-types";

const {
    btnCopyCode,
    chatMessages,
    chatSpinner,
    codeDisplay,
    codePageIndicator,
    connectionStatus,
    inputEndpoint,
    inputModel,
    modelDropdown,
    spinnerText,
} = getAiChatElements();

/** Hostnames that count as localhost. */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Updates the connection status indicator based on the endpoint URL
 * and whether the last request succeeded.
 *
 * @param connected - Whether we have a confirmed connection.
 */
export function updateConnectionStatus(connected: boolean): void {
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
 * @param fetchedModels - The fetched model IDs.
 * @param filter - The text to filter model names by.
 * @param chatStarted - Whether the current session has already started.
 */
export function showModelDropdown(
    fetchedModels: string[],
    filter: string,
    chatStarted: boolean,
): void {
    const lowerFilter = filter.toLowerCase();
    const matches = fetchedModels.filter((modelId) =>
        modelId.toLowerCase().includes(lowerFilter),
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
        option.addEventListener("mousedown", (event) => {
            event.preventDefault();
            if (chatStarted) return;
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
export function hideModelDropdown(): void {
    modelDropdown.classList.add("hidden");
}

/**
 * Appends a message bubble to the chat area.
 *
 * @param role - The message role: "user", "assistant", or "error".
 * @param text - The message text content.
 */
export function appendMessage(role: string, text: string): void {
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
export function setSpinner(show: boolean, text?: string): void {
    chatSpinner.classList.toggle("hidden", !show);
    if (text) spinnerText.textContent = text;
}

/**
 * Updates the code panel to show a specific page.
 *
 * @param codeSteps - Stored code steps for the code panel.
 * @param page - The zero-based page index to display.
 * @returns The clamped page index that is now displayed.
 */
export function showCodePage(codeSteps: CodeStep[], page: number): number {
    if (codeSteps.length === 0) {
        codeDisplay.textContent = "No code executed yet.";
        codePageIndicator.textContent = "0 / 0";
        btnCopyCode.disabled = true;
        return 0;
    }
    const clampedPage = Math.max(0, Math.min(page, codeSteps.length - 1));
    codeDisplay.textContent = codeSteps[clampedPage].code;
    codePageIndicator.textContent = `${clampedPage + 1} / ${codeSteps.length}`;
    btnCopyCode.disabled = false;
    return clampedPage;
}
