// Persists LLM request and conversation history transcripts for human review.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry } from "./chat-types";
import { generateChatHtml } from "./log-to-html.js";
import { resolvePath } from "./monty-sandbox-helpers";

/** A role and content pair accepted by the transcript renderers. */
export interface ChatTranscriptMessage {
    /** The message role. */
    role: string;
    /** The message content. */
    content: string;
}

/** Paths produced by a chat transcript dump, relative to the sandbox root. */
export interface ChatTranscriptDumpResult {
    /** Relative path to the plain-text .log file. */
    log: string;
    /** Relative path to the self-contained .html file. */
    html: string;
}

/**
 * Writes chat messages to dated log and HTML transcript files.
 *
 * @param allowedDir - The analysis directory (must be the sandbox root).
 * @param messages - The messages to dump.
 * @param model - The selected LLM model name for the HTML transcript header.
 * @param filenamePrefix - Prefix identifying the kind of transcript.
 * @returns Paths to both output files relative to allowedDir.
 */
async function writeChatTranscript(
    allowedDir: string,
    messages: ChatTranscriptMessage[],
    model: string,
    filenamePrefix: string,
): Promise<ChatTranscriptDumpResult> {
    const outputDir = join(allowedDir, "ai_chat_output");
    await mkdir(outputDir, { recursive: true });
    const safeDir = await resolvePath(allowedDir, "ai_chat_output");

    const date = new Date().toISOString().slice(0, 10);
    const uuid = randomUUID();
    const stem = `${filenamePrefix}-${date}-${uuid}`;
    const logFile = join(safeDir, `${stem}.log`);
    const htmlFile = join(safeDir, `${stem}.html`);

    const logContent = messages
        .map(
            (msg, i) =>
                `=== Message ${i + 1}: ${msg.role} ===\n\n${msg.content}`,
        )
        .join("\n\n");
    await writeFile(logFile, logContent, "utf-8");

    const htmlContent = generateChatHtml(messages, uuid, model);
    await writeFile(htmlFile, htmlContent, "utf-8");

    return {
        log: join("ai_chat_output", `${stem}.log`),
        html: join("ai_chat_output", `${stem}.html`),
    };
}

/**
 * Dumps the most recent LLM request payload to log and HTML transcript files.
 *
 * @param allowedDir - The analysis directory (must be the sandbox root).
 * @param messages - The messages sent to the LLM.
 * @param model - The selected LLM model name for the HTML transcript header.
 * @returns Paths to both output files relative to allowedDir.
 */
export async function dumpLlmInstructions(
    allowedDir: string,
    messages: ChatTranscriptMessage[],
    model: string,
): Promise<ChatTranscriptDumpResult> {
    return writeChatTranscript(allowedDir, messages, model, "nanalogue-chat");
}

/**
 * Dumps the complete unpruned conversation history without internal metadata.
 *
 * @param allowedDir - The analysis directory (must be the sandbox root).
 * @param history - The raw session history to dump.
 * @param model - The selected LLM model name for the HTML transcript header.
 * @returns Paths to both output files relative to allowedDir.
 */
export async function dumpConversationHistory(
    allowedDir: string,
    history: HistoryEntry[],
    model: string,
): Promise<ChatTranscriptDumpResult> {
    const messages = history.map(({ role, content }) => ({ role, content }));
    return writeChatTranscript(
        allowedDir,
        messages,
        model,
        "nanalogue-history",
    );
}
