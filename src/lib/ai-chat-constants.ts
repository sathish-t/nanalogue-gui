// Main-process constants for the AI Chat feature.
// Centralizes numeric limits, defaults, and configuration values used across sandbox, orchestrator, and prompt modules.

export {
    CONFIG_FIELD_SPECS,
    TEMPERATURE_SPEC,
} from "./ai-chat-shared-constants";

// --- Token estimation ---

export const /** Approximate bytes per token for context window estimation. */ BYTES_PER_TOKEN = 4;
export const /** Fraction of context budget used by the sliding window (reserve rest for system prompt). */ CONTEXT_BUDGET_FRACTION = 0.8;

// --- Network timeouts ---

export const /** Timeout in milliseconds for the model-list fetch request. */ MODEL_LIST_TIMEOUT_MS = 10_000;

// --- Orchestrator budget constants ---

export const /** Maximum cumulative sandbox runtime per turn in milliseconds (30 minutes). */ MAX_CUMULATIVE_SANDBOX_MS =
        30 * 60 * 1000;
export const /** Maximum serialized size for the facts array in bytes. */ MAX_FACTS_BYTES = 2048;
export const /** Maximum LLM tool-call round-trips per user message. */ MAX_TOOL_STEPS = 10;

// --- Sandbox execution defaults ---

export const /** Default sandbox execution timeout in seconds (10 minutes). */ DEFAULT_MAX_DURATION_SECS = 600;
export const /** Default heap memory cap in bytes (512 MB). */ DEFAULT_MAX_MEMORY =
        512 * 1024 * 1024;
export const /** Default Monty VM allocation cap. */ DEFAULT_MAX_ALLOCATIONS = 100_000;

// --- Record limit defaults ---

export const /** Default max records from read_info. */ DEFAULT_MAX_RECORDS_READ_INFO = 200_000;
export const /** Default max records from bam_mods. */ DEFAULT_MAX_RECORDS_BAM_MODS = 5_000;
export const /** Default max records from window_reads. */ DEFAULT_MAX_RECORDS_WINDOW_READS = 5_000;
export const /** Default max records from seq_table. */ DEFAULT_MAX_RECORDS_SEQ_TABLE = 5_000;

// --- Output size limits ---

export const /** Default fallback max output bytes (used when no explicit value provided). */ DEFAULT_MAX_OUTPUT_BYTES =
        20 * 1024;
export const /** Minimum output bytes floor. */ MIN_OUTPUT_BYTES = 4 * 1024;
export const /** Maximum output bytes ceiling. */ MAX_OUTPUT_BYTES = 80 * 1024;

// --- Print capture limits ---

export const /** Maximum bytes of print output to capture per sandbox execution (1 MB). */ MAX_PRINT_CAPTURE_BYTES = 1_048_576;

// --- Message size limits ---

export const /** Maximum bytes for a single user message (100 KB). */ MAX_MESSAGE_BYTES =
        100 * 1024;

// --- File operation limits ---

export const /** Maximum bytes per read_file call (1 MB). */ DEFAULT_MAX_READ_BYTES =
        1024 * 1024;
export const /** Maximum bytes per write_file call (50 MB). */ DEFAULT_MAX_WRITE_BYTES =
        50 * 1024 * 1024;
export const /** Maximum bytes for a single path component. */ MAX_FILENAME_LENGTH = 255;

// --- Listing and directory constants ---

export const /** Hard cap on ls() results to prevent host blowup. */ MAX_LS_ENTRIES = 500;
export const /** Dedicated subdirectory for write_file output. */ AI_CHAT_OUTPUT_DIR =
        "ai_chat_output";

// --- External function registry ---

export const /** All external function names registered with Monty. */ EXTERNAL_FUNCTIONS =
        [
            "peek",
            "read_info",
            "bam_mods",
            "window_reads",
            "seq_table",
            "ls",
            "read_file",
            "write_file",
            "continue_thinking",
        ] as const;
