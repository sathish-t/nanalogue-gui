// Shared helpers for handleUserMessage integration tests.

import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
} from "./chat-types";

/** Shared state returned by createHandleMessageHarness. */
export interface HandleMessageHarness {
    /** Orchestrator config. */
    config: AiChatConfig;
    /** Conversation history. */
    history: HistoryEntry[];
    /** Facts array. */
    facts: Fact[];
    /** Collected events. */
    events: AiChatEvent[];
    /** Abort signal. */
    signal: AbortSignal;
}

/**
 * Builds a minimal orchestrator config for handleUserMessage tests.
 *
 * @param overrides - Optional config overrides.
 * @returns A complete AiChatConfig object.
 */
export function createAiChatConfig(
    overrides: Partial<AiChatConfig> = {},
): AiChatConfig {
    return {
        contextWindowTokens: 8192,
        maxRetries: 1,
        timeoutSeconds: 30,
        maxRecordsReadInfo: 100,
        maxRecordsBamMods: 100,
        maxRecordsWindowReads: 100,
        maxRecordsSeqTable: 100,
        maxCodeRounds: 1,
        maxDurationSecs: 600,
        maxMemoryMB: 512,
        maxAllocations: 100_000,
        maxReadMB: 1,
        maxWriteMB: 50,
        ...overrides,
    };
}

/**
 * Builds common config and state for handleUserMessage tests.
 *
 * @param options - Optional config and signal overrides.
 * @param options.config - Optional config overrides.
 * @param options.signalTimeoutMs - Timeout in milliseconds for AbortSignal.timeout.
 * @returns Shared harness state.
 */
export function createHandleMessageHarness(options?: {
    /** Optional config overrides. */
    config?: Partial<AiChatConfig>;
    /** Timeout in milliseconds for AbortSignal.timeout. */
    signalTimeoutMs?: number;
}): HandleMessageHarness {
    return {
        config: createAiChatConfig(options?.config),
        history: [],
        facts: [],
        events: [],
        signal: AbortSignal.timeout(options?.signalTimeoutMs ?? 10_000),
    };
}
