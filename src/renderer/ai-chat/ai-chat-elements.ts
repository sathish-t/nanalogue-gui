// DOM element lookups for the AI Chat renderer.

/**
 * DOM element references used by the AI Chat renderer.
 */
interface AiChatElements {
    /** Directory input for sandbox access. */
    inputDir: HTMLInputElement;
    /** Browse button for choosing the BAM directory. */
    btnBrowse: HTMLButtonElement;
    /** Endpoint URL input. */
    inputEndpoint: HTMLInputElement;
    /** API key input. */
    inputApiKey: HTMLInputElement;
    /** Model input. */
    inputModel: HTMLInputElement;
    /** Custom dropdown containing fetched model options. */
    modelDropdown: HTMLDivElement;
    /** Fetch-models button. */
    btnFetchModels: HTMLButtonElement;
    /** Status text for model fetching. */
    fetchStatus: HTMLDivElement;
    /** Connection status indicator. */
    connectionStatus: HTMLDivElement;
    /** Opens the advanced-options dialog. */
    btnAdvanced: HTMLButtonElement;
    /** Chat message container. */
    chatMessages: HTMLDivElement;
    /** Chat loading spinner container. */
    chatSpinner: HTMLDivElement;
    /** Spinner label text. */
    spinnerText: HTMLSpanElement;
    /** Toggle button for the code panel. */
    codePanelToggle: HTMLButtonElement;
    /** Code panel content wrapper. */
    codePanelContent: HTMLDivElement;
    /** Code display pre block. */
    codeDisplay: HTMLPreElement;
    /** Code panel page indicator. */
    codePageIndicator: HTMLSpanElement;
    /** Previous-code-page button. */
    btnCodePrev: HTMLButtonElement;
    /** Next-code-page button. */
    btnCodeNext: HTMLButtonElement;
    /** Copy-code button. */
    btnCopyCode: HTMLButtonElement;
    /** User message input. */
    inputMessage: HTMLInputElement;
    /** Send-message button. */
    btnSend: HTMLButtonElement;
    /** Cancel-request button. */
    btnCancel: HTMLButtonElement;
    /** New-chat button. */
    btnNewChat: HTMLButtonElement;
    /** Back button returning to landing. */
    btnBack: HTMLButtonElement;
    /** Advanced-options dialog. */
    advancedDialog: HTMLDialogElement;
    /** Endpoint-consent dialog. */
    consentDialog: HTMLDialogElement;
    /** Opens the system-prompt preview dialog. */
    btnViewSystemPrompt: HTMLButtonElement;
    /** System-prompt preview dialog. */
    systemPromptDialog: HTMLDialogElement;
    /** System-prompt display pre block. */
    systemPromptPre: HTMLPreElement;
    /** Note describing which config the prompt preview reflects. */
    systemPromptConfigNote: HTMLParagraphElement;
    /** Rough token estimate for the prompt preview. */
    systemPromptTokenEstimate: HTMLSpanElement;
    /** Copy-system-prompt button. */
    btnCopySystemPrompt: HTMLButtonElement;
    /** Close-system-prompt button. */
    btnCloseSystemPrompt: HTMLButtonElement;
    /** Advanced option: context window. */
    optContextWindow: HTMLInputElement;
    /** Advanced option: max retries. */
    optMaxRetries: HTMLInputElement;
    /** Advanced option: timeout. */
    optTimeout: HTMLInputElement;
    /** Advanced option: max read-info records. */
    optMaxReadInfo: HTMLInputElement;
    /** Advanced option: max bam-mod records. */
    optMaxBamMods: HTMLInputElement;
    /** Advanced option: max window reads. */
    optMaxWindowReads: HTMLInputElement;
    /** Advanced option: max sequence-table records. */
    optMaxSeqTable: HTMLInputElement;
    /** Advanced option: max code rounds. */
    optMaxCodeRounds: HTMLInputElement;
    /** Advanced option: max duration. */
    optMaxDuration: HTMLInputElement;
    /** Advanced option: max memory. */
    optMaxMemory: HTMLInputElement;
    /** Advanced option: max allocations. */
    optMaxAllocations: HTMLInputElement;
    /** Advanced option: temperature. */
    optTemperature: HTMLInputElement;
    /** Advanced option: max read MB. */
    optMaxReadMB: HTMLInputElement;
    /** Advanced option: max write MB. */
    optMaxWriteMB: HTMLInputElement;
    /** Dialog text showing the consent origin. */
    consentOrigin: HTMLElement;
    /** Optional close button for the advanced dialog. */
    btnCloseAdvanced: HTMLButtonElement | null;
    /** Optional reset-to-defaults button in the advanced dialog. */
    btnDefaults: HTMLButtonElement | null;
    /** Optional consent-accept button. */
    btnConsentAccept: HTMLButtonElement | null;
    /** Optional consent-cancel button. */
    btnConsentCancel: HTMLButtonElement | null;
}

/**
 * Cached DOM element references used by the AI Chat renderer.
 */
const elements: AiChatElements = {
    inputDir: document.getElementById("input-dir") as HTMLInputElement,
    btnBrowse: document.getElementById("btn-browse") as HTMLButtonElement,
    inputEndpoint: document.getElementById(
        "input-endpoint",
    ) as HTMLInputElement,
    inputApiKey: document.getElementById("input-api-key") as HTMLInputElement,
    inputModel: document.getElementById("input-model") as HTMLInputElement,
    modelDropdown: document.getElementById("model-dropdown") as HTMLDivElement,
    btnFetchModels: document.getElementById(
        "btn-fetch-models",
    ) as HTMLButtonElement,
    fetchStatus: document.getElementById("fetch-status") as HTMLDivElement,
    connectionStatus: document.getElementById(
        "connection-status",
    ) as HTMLDivElement,
    btnAdvanced: document.getElementById("btn-advanced") as HTMLButtonElement,
    chatMessages: document.getElementById("chat-messages") as HTMLDivElement,
    chatSpinner: document.getElementById("chat-spinner") as HTMLDivElement,
    spinnerText: document.getElementById("spinner-text") as HTMLSpanElement,
    codePanelToggle: document.getElementById(
        "code-panel-toggle",
    ) as HTMLButtonElement,
    codePanelContent: document.getElementById(
        "code-panel-content",
    ) as HTMLDivElement,
    codeDisplay: document.getElementById("code-display") as HTMLPreElement,
    codePageIndicator: document.getElementById(
        "code-page-indicator",
    ) as HTMLSpanElement,
    btnCodePrev: document.getElementById("btn-code-prev") as HTMLButtonElement,
    btnCodeNext: document.getElementById("btn-code-next") as HTMLButtonElement,
    btnCopyCode: document.getElementById("btn-copy-code") as HTMLButtonElement,
    inputMessage: document.getElementById("input-message") as HTMLInputElement,
    btnSend: document.getElementById("btn-send") as HTMLButtonElement,
    btnCancel: document.getElementById("btn-cancel") as HTMLButtonElement,
    btnNewChat: document.getElementById("btn-new-chat") as HTMLButtonElement,
    btnBack: document.getElementById("btn-back") as HTMLButtonElement,
    advancedDialog: document.getElementById(
        "advanced-dialog",
    ) as HTMLDialogElement,
    consentDialog: document.getElementById(
        "consent-dialog",
    ) as HTMLDialogElement,
    btnViewSystemPrompt: document.getElementById(
        "btn-view-system-prompt",
    ) as HTMLButtonElement,
    systemPromptDialog: document.getElementById(
        "system-prompt-dialog",
    ) as HTMLDialogElement,
    systemPromptPre: document.getElementById(
        "system-prompt-pre",
    ) as HTMLPreElement,
    systemPromptConfigNote: document.getElementById(
        "system-prompt-config-note",
    ) as HTMLParagraphElement,
    systemPromptTokenEstimate: document.getElementById(
        "system-prompt-token-estimate",
    ) as HTMLSpanElement,
    btnCopySystemPrompt: document.getElementById(
        "btn-copy-system-prompt",
    ) as HTMLButtonElement,
    btnCloseSystemPrompt: document.getElementById(
        "btn-close-system-prompt",
    ) as HTMLButtonElement,
    optContextWindow: document.getElementById(
        "opt-context-window",
    ) as HTMLInputElement,
    optMaxRetries: document.getElementById(
        "opt-max-retries",
    ) as HTMLInputElement,
    optTimeout: document.getElementById("opt-timeout") as HTMLInputElement,
    optMaxReadInfo: document.getElementById(
        "opt-max-read-info",
    ) as HTMLInputElement,
    optMaxBamMods: document.getElementById(
        "opt-max-bam-mods",
    ) as HTMLInputElement,
    optMaxWindowReads: document.getElementById(
        "opt-max-window-reads",
    ) as HTMLInputElement,
    optMaxSeqTable: document.getElementById(
        "opt-max-seq-table",
    ) as HTMLInputElement,
    optMaxCodeRounds: document.getElementById(
        "opt-max-code-rounds",
    ) as HTMLInputElement,
    optMaxDuration: document.getElementById(
        "opt-max-duration",
    ) as HTMLInputElement,
    optMaxMemory: document.getElementById("opt-max-memory") as HTMLInputElement,
    optMaxAllocations: document.getElementById(
        "opt-max-allocations",
    ) as HTMLInputElement,
    optTemperature: document.getElementById(
        "opt-temperature",
    ) as HTMLInputElement,
    optMaxReadMB: document.getElementById(
        "opt-max-read-mb",
    ) as HTMLInputElement,
    optMaxWriteMB: document.getElementById(
        "opt-max-write-mb",
    ) as HTMLInputElement,
    consentOrigin: document.getElementById("consent-origin") as HTMLElement,
    btnCloseAdvanced: document.getElementById(
        "btn-close-advanced",
    ) as HTMLButtonElement | null,
    btnDefaults: document.getElementById(
        "btn-defaults",
    ) as HTMLButtonElement | null,
    btnConsentAccept: document.getElementById(
        "btn-consent-accept",
    ) as HTMLButtonElement | null,
    btnConsentCancel: document.getElementById(
        "btn-consent-cancel",
    ) as HTMLButtonElement | null,
};

/**
 * Returns the cached AI Chat DOM element references.
 *
 * @returns The cached renderer DOM references.
 */
export function getAiChatElements(): AiChatElements {
    return elements;
}
