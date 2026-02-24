// Shared types for the AI Chat feature.
// Used by monty-sandbox, chat-orchestrator, ai-chat mode module, and renderer.

/** Result of running Python code in the Monty sandbox. */
export interface SandboxResult {
    /** Whether the code executed without errors. */
    success: boolean;
    /** The return value of the sandbox code (if successful). */
    value?: unknown;
    /** Whether the output was truncated by the output gate. */
    truncated?: boolean;
    /** Whether the code ended with a bare expression (heuristic). */
    endedWithExpression?: boolean;
    /** The type of error that occurred (if unsuccessful). */
    errorType?: string;
    /** The error message (if unsuccessful). */
    message?: string;
    /** Whether the error was caused by a timeout. */
    isTimeout?: boolean;
    /** Whether continue_thinking() was called in the sandbox code. */
    continueThinkingCalled?: boolean;
    /** Captured print() output segments from sandbox code. */
    prints?: string[];
}

/** Configuration options for the Monty sandbox. */
export interface SandboxOptions {
    /** Maximum wall-clock seconds for sandbox execution. */
    maxDurationSecs?: number;
    /** Maximum heap memory in bytes. */
    maxMemory?: number;
    /** Maximum records from read_info. */
    maxRecordsReadInfo?: number;
    /** Maximum records from bam_mods. */
    maxRecordsBamMods?: number;
    /** Maximum records from window_reads. */
    maxRecordsWindowReads?: number;
    /** Maximum records from seq_table. */
    maxRecordsSeqTable?: number;
    /** Maximum number of Monty VM heap allocations. */
    maxAllocations?: number;
    /** Maximum output size in bytes (derived from context budget). */
    maxOutputBytes?: number;
}

/** An assistant message in the conversation history. */
export interface AssistantMessage {
    /** The message role. */
    role: "assistant";
    /** The text content of the message. */
    content: string;
}

/** A user message in the conversation history. */
export interface UserMessage {
    /** The message role. */
    role: "user";
    /** The text content of the message. */
    content: string;
    /** Whether this message is a code execution result (not real user input). */
    isExecutionResult?: boolean;
    /** Typed execution status for pruning (replaces string-prefix detection). */
    executionStatus?: "ok" | "error";
}

/** A single entry in the conversation history. */
export type HistoryEntry = UserMessage | AssistantMessage;

/**
 * A typed fact recording key information from successful code execution results.
 * Facts are extracted by pattern matching, not LLM summarization.
 */
export type Fact =
    | {
          /** The fact kind discriminator. */
          type: "file";
          /** The file that was referenced. */
          filename: string;
          /** The execution round that produced this fact. */
          roundId: string;
          /** When this fact was extracted (epoch ms). */
          timestamp: number;
      }
    | {
          /** The fact kind discriminator. */
          type: "filter";
          /** Human-readable description of the filter. */
          description: string;
          /** The execution round that produced this fact. */
          roundId: string;
          /** When this fact was extracted (epoch ms). */
          timestamp: number;
      }
    | {
          /** The fact kind discriminator. */
          type: "output";
          /** The filesystem path of the output file. */
          path: string;
          /** The execution round that produced this fact. */
          roundId: string;
          /** When this fact was extracted (epoch ms). */
          timestamp: number;
      };

/**
 * Events sent from main process to renderer for AI Chat progress.
 * The renderer listens on a single channel and switches on event.type.
 */
export type AiChatEvent =
    | {
          /** The event kind discriminator. */
          type: "turn_start";
      }
    | {
          /** The event kind discriminator. */
          type: "llm_request_start";
      }
    | {
          /** The event kind discriminator. */
          type: "code_execution_start";
          /** The Python code about to be executed. */
          code: string;
      }
    | {
          /** The event kind discriminator. */
          type: "code_execution_end";
          /** The sandbox execution result. */
          result: SandboxResult;
      }
    | {
          /** The event kind discriminator. */
          type: "llm_request_end";
      }
    | {
          /** The event kind discriminator. */
          type: "turn_end";
          /** The assistant's final text reply. */
          text: string;
          /** The sandbox execution steps taken during this turn. */
          steps: StepInfo[];
      }
    | {
          /** The event kind discriminator. */
          type: "turn_error";
          /** The error message. */
          error: string;
          /** Whether the error was caused by a timeout. */
          isTimeout: boolean;
      }
    | {
          /** The event kind discriminator. */
          type: "turn_cancelled";
      };

/** Information about a single sandbox execution step (for the code panel). */
export interface StepInfo {
    /** The Python code that was executed. */
    code: string;
    /** The sandbox execution result. */
    result: SandboxResult;
}

/** Configuration for the context transformation pipeline. */
export interface ContextConfig {
    /** Maximum tokens for the context window budget. */
    contextBudgetTokens: number;
}

/** Full configuration for the AI Chat orchestrator. */
export interface AiChatConfig {
    /** Context window size in tokens. */
    contextWindowTokens: number;
    /** Maximum retries per turn. */
    maxRetries: number;
    /** LLM request timeout in seconds. */
    timeoutSeconds: number;
    /** Maximum code execution rounds per user message. */
    maxCodeRounds: number;
    /** LLM sampling temperature. When undefined, omitted from request body. */
    temperature?: number;
    /** Maximum records from read_info. */
    maxRecordsReadInfo: number;
    /** Maximum records from bam_mods. */
    maxRecordsBamMods: number;
    /** Maximum records from window_reads. */
    maxRecordsWindowReads: number;
    /** Maximum records from seq_table. */
    maxRecordsSeqTable: number;
    /** Maximum sandbox execution duration in seconds. */
    maxDurationSecs: number;
    /** Maximum sandbox heap memory in megabytes (converted to bytes before use). */
    maxMemoryMB: number;
    /** Maximum Monty VM heap allocations. */
    maxAllocations: number;
}

/** Validation spec for a single AiChatConfig field. */
export interface ConfigFieldSpec {
    /** Minimum allowed value (inclusive). */
    min: number;
    /** Maximum allowed value (inclusive). */
    max: number;
    /** Default value when the field is omitted or non-numeric. */
    fallback: number;
    /** Human-readable label for error messages (e.g. "context window tokens"). */
    label: string;
}

/** Validation spec for an optional float config field (no fallback, no rounding). */
export interface OptionalFloatFieldSpec {
    /** Minimum allowed value (inclusive). */
    min: number;
    /** Maximum allowed value (inclusive). */
    max: number;
    /** Human-readable label for error messages. */
    label: string;
}
