// Shared TypeScript types for the AI Chat renderer.

import type {
    AiChatEvent,
    AiChatListModelsResult,
    AiChatSendMessageResult,
} from "../../lib/chat-types";

/** Result returned by mode launch IPC handlers. */
export interface LaunchResult {
    /** Whether the launch succeeded. */
    success: boolean;
    /** The reason for failure. */
    reason?: string;
}

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
    }) => Promise<AiChatListModelsResult>;
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
    }) => Promise<AiChatSendMessageResult>;
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
