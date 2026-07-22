// End-to-end tests for handleUserMessage /exec handling.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserMessage } from "./chat-orchestrator";
import { createHandleMessageHarness } from "./chat-orchestrator-handle-message-test-utils";
import type { AiChatEvent } from "./chat-types";

describe("/exec slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "exec-test-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("executes a Python file and returns output", async () => {
        await writeFile(join(tmpDir, "hello.py"), 'print("hello")', "utf-8");
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/exec hello.py",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events for test assertions.
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

        expect(result.text).toContain("hello");
        expect(result.text).toContain("Direct user execution");
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].code).toBe('print("hello")');
        expect(history).toHaveLength(0);

        const types = events.map((e) => e.type);
        expect(types).toContain("turn_start");
        expect(types).toContain("code_execution_start");
        expect(types).toContain("code_execution_end");
        expect(types).toContain("turn_end");
        expect(types).not.toContain("llm_request_start");
    });

    it("rejects files outside allowedDir", async () => {
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await expect(
            handleUserMessage({
                message: "/exec ../../etc/passwd",
                endpointUrl: "http://localhost:1234/v1",
                apiKey: "",
                model: "test",
                allowedDir: tmpDir,
                config,
                /**
                 * Collects emitted events for test assertions.
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

        expect(history).toHaveLength(0);
        const types = events.map((e) => e.type);
        expect(types).toContain("turn_start");
        // turn_error is emitted by ChatSession.sendMessage, not handleUserMessage
        expect(types).not.toContain("turn_error");
    });

    it("rejects non-.py files", async () => {
        await writeFile(join(tmpDir, "data.bam"), "not a bam", "utf-8");
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        await expect(
            handleUserMessage({
                message: "/exec data.bam",
                endpointUrl: "http://localhost:1234/v1",
                apiKey: "",
                model: "test",
                allowedDir: tmpDir,
                config,
                /**
                 * Collects emitted events for test assertions.
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
        ).rejects.toThrow(".py");

        expect(history).toHaveLength(0);
    });

    it("handles extra whitespace between /exec and filename", async () => {
        await writeFile(join(tmpDir, "spaces.py"), "print(42)", "utf-8");
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/exec   \t  spaces.py",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events for test assertions.
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

        expect(result.text).toContain("42");
    });

    it("returns sandbox error when file raises runtime error", async () => {
        await writeFile(
            join(tmpDir, "bad.py"),
            "print(undefined_var)",
            "utf-8",
        );
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/exec bad.py",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events for test assertions.
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

        expect(result.text).toContain("Direct user execution");
        expect(result.text).toContain("RuntimeError");
        expect(result.text).toContain("undefined_var");
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].result.success).toBe(false);
    });

    it("includes prints before a runtime error in /exec output", async () => {
        await writeFile(
            join(tmpDir, "prints_then_fails.py"),
            'print("before")\nprint(undefined_var)',
            "utf-8",
        );
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/exec prints_then_fails.py",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events for test assertions.
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

        expect(result.text).toContain("before");
        expect(result.text).toContain("RuntimeError");
        expect(result.text).toContain("undefined_var");
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].result.success).toBe(false);
    });

    it("respects removedTools when executing via /exec", async () => {
        await writeFile(join(tmpDir, "use_ls.py"), "ls()", "utf-8");
        const { config, history, facts, events, signal } =
            createHandleMessageHarness();

        const result = await handleUserMessage({
            message: "/exec use_ls.py",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config,
            /**
             * Collects emitted events for test assertions.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal,
            removedTools: new Set(["ls"]),
        });

        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].result.success).toBe(false);
    });
});
