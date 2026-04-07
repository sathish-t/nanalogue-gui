// Unit tests for chat-orchestrator helper utilities.
// Covers dump-command helper behavior after extraction from the main orchestrator.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    type DumpableLlmMessage,
    handleDumpCommand,
} from "./chat-orchestrator-helpers";
import type { AiChatConfig, AiChatEvent, HistoryEntry } from "./chat-types";

/** Minimal AI chat config shared by dump-command helper tests. */
const testConfig: AiChatConfig = {
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
};

/**
 * Builds a conversation history containing the given command as the newest entry.
 *
 * @param command - The slash command to append as the newest message.
 * @returns The history array.
 */
function historyWithCommand(command: string): HistoryEntry[] {
    return [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: command },
    ];
}

describe("handleDumpCommand", () => {
    let tmpDir: string;
    let events: AiChatEvent[];

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-helper-test-"));
        events = [];
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("pops the /dump_llm_instructions command from history", async () => {
        const history = historyWithCommand("/dump_llm_instructions");
        const lastSentMessages: DumpableLlmMessage[] = [
            { role: "system", content: "Prompt" },
        ];

        const result = await handleDumpCommand({
            message: "/dump_llm_instructions",
            allowedDir: tmpDir,
            config: testConfig,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            lastSentMessages,
            dumpLlmInstructions: vi.fn(async () => ({
                log: "ai_chat_output/test.log",
                html: "ai_chat_output/test.html",
            })),
        });

        expect(result).not.toBeNull();
        expect(history).toEqual([
            { role: "user", content: "Earlier question" },
            { role: "assistant", content: "Earlier answer" },
        ]);
    });

    it("pops the /dump_system_prompt command from history", async () => {
        const history = historyWithCommand("/dump_system_prompt");

        const result = await handleDumpCommand({
            message: "/dump_system_prompt",
            allowedDir: tmpDir,
            config: testConfig,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            lastSentMessages: null,
            dumpLlmInstructions: vi.fn(),
        });

        expect(result).not.toBeNull();
        expect(history).toEqual([
            { role: "user", content: "Earlier question" },
            { role: "assistant", content: "Earlier answer" },
        ]);
    });

    it("returns null and leaves history unchanged for non-dump messages", async () => {
        const history = historyWithCommand("hello");

        const result = await handleDumpCommand({
            message: "hello",
            allowedDir: tmpDir,
            config: testConfig,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            lastSentMessages: null,
            dumpLlmInstructions: vi.fn(),
        });

        expect(result).toBeNull();
        expect(history).toEqual(historyWithCommand("hello"));
        expect(events).toHaveLength(0);
    });

    it("writes the appended system prompt content when dumping the system prompt", async () => {
        const history = historyWithCommand("/dump_system_prompt");

        const result = await handleDumpCommand({
            message: "/dump_system_prompt",
            allowedDir: tmpDir,
            config: testConfig,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            lastSentMessages: null,
            dumpLlmInstructions: vi.fn(),
            appendSystemPrompt: "APPENDED DOMAIN CONTEXT",
            replaceSystemPrompt: "BASE PROMPT",
        });

        expect(result).not.toBeNull();
        const turnEndEvent = events.find((event) => event.type === "turn_end");
        expect(turnEndEvent?.type).toBe("turn_end");
        if (turnEndEvent?.type !== "turn_end") {
            throw new Error("Expected a turn_end event");
        }
        const dumpedPath = turnEndEvent.text.match(
            /^System prompt dumped to (.+)$/m,
        )?.[1];
        expect(dumpedPath).toBeTruthy();
        if (!dumpedPath) {
            throw new Error(
                "Expected dumped system prompt path in turn_end text",
            );
        }
        const promptContent = await readFile(join(tmpDir, dumpedPath), "utf-8");
        expect(promptContent).toBe("BASE PROMPT\n\nAPPENDED DOMAIN CONTEXT");
    });
});
