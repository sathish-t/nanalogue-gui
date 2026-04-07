// Helper utilities for chat-orchestrator.
// Extracts smaller command-handling paths from the main orchestration function.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
    AiChatConfig,
    AiChatEvent,
    HandleMessageResult,
    HistoryEntry,
} from "./chat-types";
import { deriveMaxOutputBytes, resolvePath } from "./monty-sandbox-helpers";
import {
    buildStaticSystemPromptParts,
    joinSystemPromptParts,
} from "./sandbox-prompt";

/** Serialized LLM message content that can be dumped to disk. */
export interface DumpableLlmMessage {
    /** The message role. */
    role: string;
    /** The message content. */
    content: string;
}

/** Callback for persisting an LLM instruction dump. */
export type DumpLlmInstructionsFn = (
    allowedDir: string,
    messages: DumpableLlmMessage[],
) => Promise<{
    /** Relative path to the plain-text log file. */
    log: string;
    /** Relative path to the HTML file. */
    html: string;
} | null>;

/** Options for the dump-command handler helper. */
export interface DumpCommandHandlerOptions {
    /** The user's message text. */
    message: string;
    /** The allowed directory for BAM files. */
    allowedDir: string;
    /** The orchestrator configuration. */
    config: AiChatConfig;
    /** Callback for emitting events to the renderer. */
    emitEvent: (event: AiChatEvent) => void;
    /** The conversation history (mutated in place). */
    history: HistoryEntry[];
    /** Most recent messages sent to the LLM, if any. */
    lastSentMessages: DumpableLlmMessage[] | null;
    /** Callback for dumping last-sent LLM instructions. */
    dumpLlmInstructions: DumpLlmInstructionsFn;
    /** Optional text to append to the default system prompt. */
    appendSystemPrompt?: string;
    /** Optional text to replace the default system prompt entirely. */
    replaceSystemPrompt?: string;
}

/**
 * Handles dump-related slash commands.
 *
 * @param options - The dump-command handler options.
 * @returns The command result, or null if the message is not a dump command.
 */
export async function handleDumpCommand(
    options: DumpCommandHandlerOptions,
): Promise<HandleMessageResult | null> {
    const {
        message,
        allowedDir,
        config,
        emitEvent,
        history,
        lastSentMessages,
        dumpLlmInstructions,
        appendSystemPrompt,
        replaceSystemPrompt,
    } = options;

    // Handle /dump_llm_instructions — dump last LLM request payload to file.
    if (message.match(/^\/dump_llm_instructions\s*$/)) {
        history.pop();
        emitEvent({ type: "turn_start" });

        const dump = lastSentMessages
            ? await dumpLlmInstructions(allowedDir, lastSentMessages)
            : null;
        const text = dump
            ? `LLM instructions dumped to ${dump.log}\n` +
              `HTML view: ${dump.html}\n` +
              "These files are not fed back to the LLM. Do not reference them in conversations."
            : "No LLM call has been made yet, nothing to dump.";
        emitEvent({ type: "turn_end", text, steps: [] });
        return { text, steps: [] };
        // Handle /dump_system_prompt — dump the static system prompt to file.
    } else if (message.match(/^\/dump_system_prompt\s*$/)) {
        history.pop();
        emitEvent({ type: "turn_start" });

        const outputDir = join(allowedDir, "ai_chat_output");
        await mkdir(outputDir, { recursive: true });
        const safeDir = await resolvePath(allowedDir, "ai_chat_output");

        const date = new Date().toISOString().slice(0, 10);
        const uuid = randomUUID();
        const filename = `nanalogue-chat-${date}-${uuid}.log`;
        const outputFile = join(safeDir, filename);

        const maxOutputBytes = deriveMaxOutputBytes(config.contextWindowTokens);
        const maxOutputKB = Math.round(maxOutputBytes / 1024);
        // Include SYSTEM_APPEND.md content in the dump so it accurately
        // reflects the reusable static system prompt sent on every turn.
        // Dynamic per-conversation facts are intentionally excluded from this
        // dump because they vary across turns and are not part of the shared
        // base prompt template.
        const promptParts = buildStaticSystemPromptParts({
            config,
            maxOutputKB,
            appendSystemPrompt,
            replaceSystemPrompt,
        });
        const promptContent = joinSystemPromptParts(promptParts);
        await writeFile(outputFile, promptContent, "utf-8");

        const relPath = relative(allowedDir, outputFile);
        const text =
            `System prompt dumped to ${relPath}\n` +
            "This message is not fed back to the LLM. Do not reference this file in conversations.";
        emitEvent({ type: "turn_end", text, steps: [] });
        return { text, steps: [] };
    } else {
        return null;
    }
}
