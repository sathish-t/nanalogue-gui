// Builds the LLM system prompt and assembles the full system message sent on every turn.
// All numeric limits are derived from code constants, not hardcoded in prose.

import type { AiChatConfig } from "./chat-types";
import { buildSandboxPrompt } from "./sandbox-prompt-text";

export type { SandboxPromptOptions } from "./sandbox-prompt-text";
export { buildSandboxPrompt } from "./sandbox-prompt-text";

/** Prompt-related config fields needed to construct the system prompt blocks. */
export type SystemPromptConfig = Pick<
    AiChatConfig,
    | "maxRecordsReadInfo"
    | "maxRecordsBamMods"
    | "maxRecordsWindowReads"
    | "maxRecordsSeqTable"
    | "maxReadMB"
    | "maxWriteMB"
    | "maxDurationSecs"
>;

/** Non-overlapping blocks that make up the system prompt. */
export interface SystemPromptParts {
    /** The built-in sandbox prompt, or the replacement prompt when provided. */
    base: string;
    /** Optional extra prompt text appended after the base prompt. */
    append: string;
}

/** Options for building the system prompt blocks. */
export interface BuildSystemPromptPartsOptions {
    /** Runtime config values that parameterize the default sandbox prompt. */
    config: SystemPromptConfig;
    /** Precomputed output ceiling in KB used by the default sandbox prompt. */
    maxOutputKB: number;
    /** Optional text appended after the base prompt. */
    appendSystemPrompt?: string;
    /** Optional text that replaces the built-in sandbox prompt entirely. */
    replaceSystemPrompt?: string;
}

/**
 * Builds the reusable base and append blocks shared by all system prompt variants.
 *
 * @param options - The static prompt assembly options.
 * @returns The base and append blocks as separate strings.
 */
export function buildSystemPromptParts(
    options: BuildSystemPromptPartsOptions,
): SystemPromptParts {
    const { config, maxOutputKB, appendSystemPrompt, replaceSystemPrompt } =
        options;
    const base =
        replaceSystemPrompt ??
        buildSandboxPrompt({
            maxOutputKB,
            maxRecordsReadInfo: config.maxRecordsReadInfo,
            maxRecordsBamMods: config.maxRecordsBamMods,
            maxRecordsWindowReads: config.maxRecordsWindowReads,
            maxRecordsSeqTable: config.maxRecordsSeqTable,
            maxReadMB: config.maxReadMB,
            maxWriteMB: config.maxWriteMB,
            maxDurationSecs: config.maxDurationSecs,
        });

    return {
        base,
        append: appendSystemPrompt ?? "",
    };
}

/**
 * Joins non-empty system prompt blocks using the standard double-newline separator.
 *
 * @param parts - Named prompt blocks assembled in base → append order.
 * @returns The assembled system prompt.
 */
export function joinSystemPromptParts(parts: SystemPromptParts): string {
    return [parts.base, parts.append]
        .filter((part) => part.length > 0)
        .join("\n\n");
}
