// End-to-end tests for handleUserMessage /dump_history handling.

import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserMessage } from "./chat-orchestrator";
import { createHandleMessageHarness } from "./chat-orchestrator-handle-message-test-utils";
import type { AiChatEvent } from "./chat-types";

describe("/dump_history slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-history-test-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("returns nothing-to-dump and removes the command when history is empty", async () => {
        const { config, history, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/dump_history",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            signal,
        });

        expect(result.text).toBe(
            "No conversation history yet, nothing to dump.",
        );
        expect(history).toHaveLength(0);
        await expect(readdir(join(tmpDir, "ai_chat_output"))).rejects.toThrow();
    });

    it("dumps every raw history message without system prompt or metadata", async () => {
        const { config, history, events, signal } =
            createHandleMessageHarness();
        history.push(
            { role: "user", content: "Original question" },
            { role: "assistant", content: "first_attempt()" },
            {
                role: "user",
                content: "Code execution result: first failure",
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "Final answer" },
        );

        const result = await handleUserMessage({
            message: "/dump_history   ",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "selected-model",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            signal,
        });

        expect(result.text).toContain("Conversation history dumped to");
        expect(history).toHaveLength(4);

        const files = await readdir(join(tmpDir, "ai_chat_output"));
        const logFile = files.find((file) => file.endsWith(".log"));
        const htmlFile = files.find((file) => file.endsWith(".html"));
        expect(logFile).toMatch(
            /^nanalogue-history-\d{4}-\d{2}-\d{2}-[\da-f-]+\.log$/,
        );
        expect(htmlFile).toMatch(
            /^nanalogue-history-\d{4}-\d{2}-\d{2}-[\da-f-]+\.html$/,
        );
        if (!logFile || !htmlFile) {
            throw new Error("Expected history transcript log and HTML files");
        }

        const log = await readFile(
            join(tmpDir, "ai_chat_output", logFile),
            "utf-8",
        );
        expect(log).toContain("=== Message 1: user ===\n\nOriginal question");
        expect(log).toContain(
            "=== Message 2: assistant ===\n\nfirst_attempt()",
        );
        expect(log).toContain("Code execution result: first failure");
        expect(log).toContain("=== Message 4: assistant ===\n\nFinal answer");
        expect(log).not.toContain("=== Message 1: system ===");
        expect(log).not.toContain("isExecutionResult");
        expect(log).not.toContain("executionStatus");
        expect(log).not.toContain("/dump_history");

        const html = await readFile(
            join(tmpDir, "ai_chat_output", htmlFile),
            "utf-8",
        );
        expect(html).toContain("4 messages · selected-model · generated");
        expect(html).toContain("Original question");
        expect(html).toContain("Final answer");
        expect(html).not.toContain('<details class="message message-system">');
        expect(html).not.toContain("isExecutionResult");
        expect(html).not.toContain("executionStatus");
    });

    it("reports a sandbox-relative path when allowedDir is a symlink", async () => {
        const linkedDir = `${tmpDir}-link`;
        await symlink(tmpDir, linkedDir);
        try {
            const { config, history, events, signal } =
                createHandleMessageHarness();
            history.push({ role: "user", content: "Original question" });

            const result = await handleUserMessage({
                message: "/dump_history",
                endpointUrl: "http://localhost:1234/v1",
                apiKey: "",
                model: "test-model",
                allowedDir: linkedDir,
                config,
                /**
                 * Collects emitted events.
                 *
                 * @param event - The event to collect.
                 */
                emitEvent: (event: AiChatEvent) => {
                    events.push(event);
                },
                history,
                signal,
            });

            const dumpedPath = result.text.match(
                /^Conversation history dumped to (.+)$/m,
            )?.[1];
            expect(dumpedPath).toMatch(
                /^ai_chat_output[/\\]nanalogue-history-.+\.log$/,
            );
            expect(dumpedPath).not.toContain("..");
        } finally {
            await rm(linkedDir, { force: true });
        }
    });
});
