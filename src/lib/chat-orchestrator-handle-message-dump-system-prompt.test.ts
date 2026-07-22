// End-to-end tests for handleUserMessage /dump_system_prompt handling.

import {
    mkdtemp,
    readdir,
    readFile,
    rm,
    symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandleMessageHarness } from "./chat-orchestrator-handle-message-test-utils";
import {
    handleUserMessage,
    resetLastSentMessages,
} from "./chat-orchestrator";
import type { AiChatEvent } from "./chat-types";

describe("/dump_system_prompt slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-sys-prompt-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("dumps system prompt even when no LLM call has been made yet", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        });

        expect(result.text).toContain("System prompt dumped to");
        expect(result.text).toContain("not fed back to the LLM");
        expect(result.steps).toHaveLength(0);

        const files = await readdir(join(tmpDir, "ai_chat_output"));
        expect(files).toHaveLength(1);
    });

    it("does not add command to conversation history", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        });

        expect(history).toHaveLength(0);
    });

    it("writes non-empty content to the dump file", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        });

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");
        expect(content.length).toBeGreaterThan(0);
    });

    it("filename matches nanalogue-chat-{date}-{uuid}.log pattern", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        });

        const files = await readdir(join(tmpDir, "ai_chat_output"));
        expect(files[0]).toMatch(
            /^nanalogue-chat-\d{4}-\d{2}-\d{2}-[\da-f-]+\.log$/,
        );
    });

    it("writes a new file each invocation rather than overwriting", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();
        const opts = {
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        };

        await handleUserMessage(opts);
        await handleUserMessage(opts);

        const files = await readdir(join(tmpDir, "ai_chat_output"));
        expect(files).toHaveLength(2);
        expect(files[0]).not.toBe(files[1]);
    });

    it("handles trailing whitespace in command", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/dump_system_prompt   ",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
        });

        expect(result.text).toContain("System prompt dumped to");
        expect(result.text).toContain("not fed back to the LLM");
        const files = await readdir(join(tmpDir, "ai_chat_output"));
        expect(files).toHaveLength(1);
    });

    it("rejects when ai_chat_output is a symlink outside allowed dir", async () => {
        const outsideDir = await mkdtemp(join(tmpdir(), "dump-sys-escape-"));
        try {
            await symlink(outsideDir, join(tmpDir, "ai_chat_output"));

            const { config, history, facts, events, signal } =
                createHandleMessageHarness();

            await expect(
                handleUserMessage({
                    message: "/dump_system_prompt",
                    endpointUrl: "http://localhost:1234/v1",
                    apiKey: "",
                    model: "test",
                    allowedDir: tmpDir,
                    config,
                    /**
                     * Collects emitted events.
                     *
                     * @param e - The event to collect.
                     */
                    emitEvent: (e: AiChatEvent) => {
                        events.push(e);
                    },
                    history,
                    facts,
                    signal,
                }),
            ).rejects.toThrow();

            // Verify nothing was written to the outside directory
            const outsideFiles = await readdir(outsideDir);
            expect(outsideFiles).toHaveLength(0);
        } finally {
            await rm(outsideDir, { recursive: true, force: true });
        }
    });
});
