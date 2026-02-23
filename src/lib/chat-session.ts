// Reusable chat session state for the AI Chat feature.
// Wraps conversation history, facts, and abort handling so both the GUI and CLI share the same logic.

import { handleUserMessage } from "./chat-orchestrator";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
} from "./chat-types";

/** Options for sending a message through a ChatSession. */
export interface SendMessageOptions {
    /** The LLM endpoint URL. */
    endpointUrl: string;
    /** The API key (may be empty for local endpoints). */
    apiKey: string;
    /** The model identifier. */
    model: string;
    /** The user's message text. */
    message: string;
    /** The allowed directory for BAM file analysis. */
    allowedDir: string;
    /** The orchestrator configuration. */
    config: AiChatConfig;
    /** Callback for emitting progress events. */
    emitEvent: (event: AiChatEvent) => void;
}

/** Successful send result. */
interface SendSuccess {
    /** Whether the send succeeded. */
    success: true;
    /** The assistant's text response. */
    text: string;
    /** The sandbox execution steps. */
    steps: Array<{
        /** The Python code that was executed. */
        code: string;
        /** The sandbox execution result. */
        result: {
            /** Whether the execution succeeded. */
            success: boolean;
            /** The return value (if successful). */
            value?: unknown;
            /** The error type (if unsuccessful). */
            errorType?: string;
            /** The error message (if unsuccessful). */
            message?: string;
        };
    }>;
}

/** Failed send result. */
interface SendFailure {
    /** Whether the send succeeded. */
    success: false;
    /** The error message. */
    error: string;
    /** Whether the failure was caused by a timeout. */
    isTimeout?: boolean;
}

/** Result of a sendMessage call. */
export type SendMessageResult = SendSuccess | SendFailure;

/**
 * Manages conversation state for a single AI Chat session.
 * Both the Electron IPC layer and CLI entry point use this class.
 */
export class ChatSession {
    /** Conversation history for the current session. */
    history: HistoryEntry[] = [];
    /** Accumulated facts from successful code execution results. */
    facts: Fact[] = [];
    /** Monotonic request counter for stale response detection. */
    requestId = 0;
    /** Abort controller for the current in-flight request. */
    currentAbortController: AbortController | null = null;

    /**
     * Sends a user message through the orchestrator and returns the response.
     *
     * @param options - The message options including endpoint, model, and config.
     * @returns The assistant response or a cancellation/error result.
     */
    async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
        const {
            endpointUrl,
            apiKey,
            model,
            message,
            allowedDir,
            config,
            emitEvent,
        } = options;

        this.requestId += 1;
        const thisRequestId = this.requestId;
        this.currentAbortController?.abort();
        this.currentAbortController = new AbortController();
        const localSignal = this.currentAbortController.signal;

        try {
            const result = await handleUserMessage({
                message,
                endpointUrl,
                apiKey,
                model,
                allowedDir,
                config,
                emitEvent,
                history: this.history,
                facts: this.facts,
                signal: localSignal,
            });

            // Check for cancellation or stale response. Cancel increments
            // requestId, so check the abort signal first to return the
            // correct "Cancelled" status instead of "Request superseded".
            if (localSignal.aborted) {
                emitEvent({ type: "turn_cancelled" });
                return { success: false, error: "Cancelled" };
            }
            if (thisRequestId !== this.requestId) {
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
            if (thisRequestId !== this.requestId) {
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
    }

    /**
     * Cancels the current in-flight LLM/sandbox request.
     */
    cancel(): void {
        this.requestId += 1;
        this.currentAbortController?.abort();
        this.currentAbortController = null;
    }

    /**
     * Resets conversation state without losing connection settings.
     */
    reset(): void {
        this.history = [];
        this.facts = [];
        this.requestId += 1;
        this.currentAbortController?.abort();
        this.currentAbortController = null;
    }
}
