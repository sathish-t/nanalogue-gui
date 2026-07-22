// Shared TypeScript types for the AI Chat renderer.

/** Result returned by mode launch IPC handlers. */
export interface LaunchResult {
    /** Whether the launch succeeded. */
    success: boolean;
    /** The reason for failure. */
    reason?: string;
}

/** A sandbox code step shown in the code panel. */
export interface CodeStep {
    /** The Python code that was executed. */
    code: string;
    /** The sandbox execution result. */
    result: unknown;
}

/** Successful send-message response with assistant text and optional code steps. */
export interface SendMessageSuccess {
    /** Discriminant — the request succeeded. */
    success: true;
    /** The assistant's text response. */
    text?: string;
    /** Tool execution steps for the code panel. */
    steps?: CodeStep[];
}

/** Failed send-message response with an error description. */
export interface SendMessageFailure {
    /** Discriminant — the request failed. */
    success: false;
    /** Error message describing the failure. */
    error: string;
    /** Whether the error was a timeout. */
    isTimeout?: boolean;
    /** Endpoint origin requiring consent (set when error is CONSENT_REQUIRED). */
    origin?: string;
}

/** Discriminated union for the send-message IPC response. */
export type SendMessageResult = SendMessageSuccess | SendMessageFailure;

/** Successful get-system-prompt response with the prompt text. */
export interface GetSystemPromptSuccess {
    /** Discriminant — the request succeeded. */
    success: true;
    /** The static system prompt text. */
    prompt: string;
}

/** Failed get-system-prompt response with an error description. */
export interface GetSystemPromptFailure {
    /** Discriminant — the request failed. */
    success: false;
    /** Error message describing the failure. */
    error: string;
}

/** Discriminated union for the get-system-prompt IPC response. */
export type GetSystemPromptResult =
    | GetSystemPromptSuccess
    | GetSystemPromptFailure;

/** Successful list-models response with the available model IDs. */
export interface ListModelsSuccess {
    /** Discriminant — the request succeeded. */
    success: true;
    /** Available model IDs. */
    models: string[];
}

/** Failed list-models response with an error description. */
export interface ListModelsFailure {
    /** Discriminant — the request failed. */
    success: false;
    /** Error message describing the failure. */
    error: string;
    /** Endpoint origin when consent is required. */
    origin?: string;
}

/** Discriminated union for the list-models IPC response. */
export type ListModelsResult = ListModelsSuccess | ListModelsFailure;

/** Event sent from main process during AI Chat turns. */
export interface AiChatEvent {
    /** The event type discriminator. */
    type: string;
    /** Python code for code_execution_start events. */
    code?: string;
    /** Sandbox result for code_execution_end events. */
    result?: unknown;
    /** Assistant text for turn_end events. */
    text?: string;
    /** Code steps for turn_end events. */
    steps?: CodeStep[];
    /** Error message for turn_error events. */
    error?: string;
    /** Whether the error was a timeout. */
    isTimeout?: boolean;
}

/** Preload API exposed to the AI Chat renderer. */
export interface AiChatApi {
    /** Launch the AI Chat mode. */
    launchAiChat: () => Promise<LaunchResult>;
    /** Retrieve the effective system prompt for the given config. */
    aiChatGetSystemPrompt: (payload: {
        /** The advanced configuration options. */
        config: Record<string, unknown>;
        /** The analysis directory for SYSTEM_APPEND.md lookup (optional). */
        allowedDir?: string;
    }) => Promise<GetSystemPromptResult>;
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
