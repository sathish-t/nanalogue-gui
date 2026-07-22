// End-to-end tests for handleUserMessage /dump_llm_instructions handling.

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
    setLastSentMessages,
} from "./chat-orchestrator";
import type { AiChatEvent } from "./chat-types";

describe("/dump_llm_instructions slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("returns nothing-to-dump when no LLM call has been attempted", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/dump_llm_instructions",
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

        expect(result.text).toBe(
            "No LLM call has been made yet, nothing to dump.",
        );
        expect(result.steps).toHaveLength(0);

        // Verify no file was written
        const outputDir = join(tmpDir, "ai_chat_output");
        await expect(readdir(outputDir)).rejects.toThrow();
    });

    it("does not add command to conversation history", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_llm_instructions",
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

    it("writes plain-text sections with message headers", async () => {
        setLastSentMessages([
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello there." },
        ]);
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_llm_instructions",
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
        const logFile = files.find((f) => f.endsWith(".log"));
        expect(logFile).toBeDefined();
        const content = await readFile(join(outputDir, logFile as string), "utf-8");

        expect(content).toContain("=== Message 1: system ===");
        expect(content).toContain("You are a helpful assistant.");
        expect(content).toContain("=== Message 2: user ===");
        expect(content).toContain("Hello there.");
    });

    it("filename matches nanalogue-chat-{date}-{uuid}.log pattern", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await handleUserMessage({
            message: "/dump_llm_instructions",
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
        const logFiles = files.filter((f) => f.endsWith(".log"));
        expect(logFiles).toHaveLength(1);
        expect(logFiles[0]).toMatch(
            /^nanalogue-chat-\d{4}-\d{2}-\d{2}-[\da-f-]+\.log$/,
        );
        const htmlFiles = files.filter((f) => f.endsWith(".html"));
        expect(htmlFiles).toHaveLength(1);
        expect(htmlFiles[0]).toMatch(
            /^nanalogue-chat-\d{4}-\d{2}-\d{2}-[\da-f-]+\.html$/,
        );
    });

    it("produces unique files on repeated invocations", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();
        const opts = {
            message: "/dump_llm_instructions",
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
        const logFiles = files.filter((f) => f.endsWith(".log"));
        const htmlFiles = files.filter((f) => f.endsWith(".html"));
        // Two invocations produce two distinct .log files and two distinct .html files.
        expect(logFiles).toHaveLength(2);
        expect(htmlFiles).toHaveLength(2);
        expect(logFiles[0]).not.toBe(logFiles[1]);
        expect(htmlFiles[0]).not.toBe(htmlFiles[1]);
    });

    it("handles trailing whitespace in command", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/dump_llm_instructions   ",
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

        expect(result.text).toContain("LLM instructions dumped to");
        expect(result.text).toContain("not fed back to the LLM");
        const files = await readdir(join(tmpDir, "ai_chat_output"));
        // One .log and one .html are written per invocation.
        expect(files.filter((f) => f.endsWith(".log"))).toHaveLength(1);
        expect(files.filter((f) => f.endsWith(".html"))).toHaveLength(1);
    });

    it("rejects when ai_chat_output is a symlink outside allowed dir", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const outsideDir = await mkdtemp(join(tmpdir(), "dump-escape-"));
        try {
            await symlink(outsideDir, join(tmpDir, "ai_chat_output"));

            const { config, history, facts, events, signal } =
                createHandleMessageHarness();

            await expect(
                handleUserMessage({
                    message: "/dump_llm_instructions",
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
