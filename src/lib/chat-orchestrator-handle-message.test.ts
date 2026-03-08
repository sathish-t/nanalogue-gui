// End-to-end tests for handleUserMessage.
// Tests /exec, /dump_llm_instructions, /dump_system_prompt, appendSystemPrompt, and replaceSystemPrompt.

import {
    mkdtemp,
    readdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    handleUserMessage,
    resetLastSentMessages,
    setLastSentMessages,
} from "./chat-orchestrator";
import {
    type MockServer,
    startMockServer,
} from "./chat-orchestrator-test-utils";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
} from "./chat-types";

describe("/exec slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "exec-test-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Builds a minimal config and shared state for /exec tests.
     *
     * @returns Config, empty history, empty facts, events collector, and abort signal.
     */
    function execTestHarness(): {
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
    } {
        return {
            config: {
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
            },
            history: [],
            facts: [],
            events: [] as AiChatEvent[],
            signal: AbortSignal.timeout(10_000),
        };
    }

    it("executes a Python file and returns output", async () => {
        await writeFile(join(tmpDir, "hello.py"), 'print("hello")', "utf-8");
        const { config, history, facts, events, signal } = execTestHarness();

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
        const { config, history, facts, events, signal } = execTestHarness();

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
        const { config, history, facts, events, signal } = execTestHarness();

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
        const { config, history, facts, events, signal } = execTestHarness();

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
        const { config, history, facts, events, signal } = execTestHarness();

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
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].result.success).toBe(false);
    });

    it("respects removedTools when executing via /exec", async () => {
        await writeFile(join(tmpDir, "use_ls.py"), "ls()", "utf-8");
        const { config, history, facts, events, signal } = execTestHarness();

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

describe("/dump_llm_instructions slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Builds a minimal config and shared state for dump tests.
     *
     * @returns Config, empty history, empty facts, events collector, and abort signal.
     */
    function dumpTestHarness(): {
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
    } {
        return {
            config: {
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
            },
            history: [],
            facts: [],
            events: [] as AiChatEvent[],
            signal: AbortSignal.timeout(10_000),
        };
    }

    it("returns nothing-to-dump when no LLM call has been attempted", async () => {
        const { config, history, facts, events, signal } = dumpTestHarness();

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
        const { config, history, facts, events, signal } = dumpTestHarness();

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
        const { config, history, facts, events, signal } = dumpTestHarness();

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
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("=== Message 1: system ===");
        expect(content).toContain("You are a helpful assistant.");
        expect(content).toContain("=== Message 2: user ===");
        expect(content).toContain("Hello there.");
    });

    it("filename matches nanalogue-chat-{date}-{uuid}.log pattern", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } = dumpTestHarness();

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
        expect(files[0]).toMatch(
            /^nanalogue-chat-\d{4}-\d{2}-\d{2}-[\da-f-]+\.log$/,
        );
    });

    it("produces unique files on repeated invocations", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } = dumpTestHarness();
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
        expect(files).toHaveLength(2);
        expect(files[0]).not.toBe(files[1]);
    });

    it("handles trailing whitespace in command", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const { config, history, facts, events, signal } = dumpTestHarness();

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
        expect(files).toHaveLength(1);
    });

    it("rejects when ai_chat_output is a symlink outside allowed dir", async () => {
        setLastSentMessages([{ role: "system", content: "test prompt" }]);
        const outsideDir = await mkdtemp(join(tmpdir(), "dump-escape-"));
        try {
            await symlink(outsideDir, join(tmpDir, "ai_chat_output"));

            const { config, history, facts, events, signal } =
                dumpTestHarness();

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

describe("/dump_system_prompt slash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dump-sys-prompt-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Builds a minimal config and shared state for dump-system-prompt tests.
     *
     * @returns Config, empty history, empty facts, events collector, and abort signal.
     */
    function dumpSysPromptHarness(): {
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
    } {
        return {
            config: {
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
            },
            history: [],
            facts: [],
            events: [] as AiChatEvent[],
            signal: AbortSignal.timeout(10_000),
        };
    }

    it("dumps system prompt even when no LLM call has been made yet", async () => {
        const { config, history, facts, events, signal } =
            dumpSysPromptHarness();

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
            dumpSysPromptHarness();

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
            dumpSysPromptHarness();

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
            dumpSysPromptHarness();

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
            dumpSysPromptHarness();
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
            dumpSysPromptHarness();

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
                dumpSysPromptHarness();

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

// Tests for SYSTEM_APPEND.md support via appendSystemPrompt.
describe("appendSystemPrompt", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "append-prompt-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for append-prompt tests. */
    const cfg: AiChatConfig = {
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
     * Calls handleUserMessage with the given appendSystemPrompt and returns
     * the request bodies captured by the mock server.
     *
     * @param appendText - Text to append to the system prompt, or undefined.
     * @param serverUrl - The mock server base URL.
     * @returns The captured LLM request bodies.
     */
    async function callWithAppend(
        appendText: string | undefined,
        serverUrl: string,
    ): Promise<Array<Record<string, unknown>>> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt: appendText,
        });
        return mockServer?.requestBodies() ?? [];
    }

    it("includes appendSystemPrompt content in the system message sent to LLM", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('hello')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithAppend(
            "## Domain context\nThese files are from a cancer methylation study.",
            mockServer.url,
        );

        expect(bodies.length).toBeGreaterThan(0);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemMsg = messages.find((m) => m.role === "system");
        expect(systemMsg).toBeDefined();
        // Appended content must be present.
        expect(systemMsg?.content).toContain("Domain context");
        expect(systemMsg?.content).toContain("cancer methylation study");
        // Default sandbox prompt content must still be present.
        expect(systemMsg?.content).toContain("read_info");
    });

    it("appended text appears after the sandbox prompt", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('ok')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const appendText = "## Custom instructions\nAlways use read_info.";
        const bodies = await callWithAppend(appendText, mockServer.url);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // "## Constraints" is near the end of the sandbox prompt.
        // The custom append must follow it.
        const sandboxEnd = systemContent.indexOf("## Constraints");
        const appendStart = systemContent.indexOf("## Custom instructions");
        expect(sandboxEnd).toBeGreaterThan(-1);
        expect(appendStart).toBeGreaterThan(sandboxEnd);
    });

    it("appended text appears before the facts block", async () => {
        // Pre-seed one fact so that buildSystemPrompt appends a facts block.
        // The expected ordering is: sandbox prompt → append → facts block.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('ok')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [
            {
                type: "filter",
                description: "mapped reads only",
                roundId: "round-1",
                timestamp: Date.now(),
            },
        ];
        const appendText =
            "## Custom instructions\nAlways use read_info first.";

        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt: appendText,
        });

        const bodies = mockServer.requestBodies();
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        const appendStart = systemContent.indexOf("## Custom instructions");
        const factsStart = systemContent.indexOf("## Conversation facts");
        expect(appendStart).toBeGreaterThan(-1);
        expect(factsStart).toBeGreaterThan(-1);
        expect(appendStart).toBeLessThan(factsStart);
    });

    it("system message is unchanged when appendSystemPrompt is undefined", async () => {
        // Capture system content WITH append.
        // Assign to mockServer so callWithAppend can access requestBodies().
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('a')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const bodiesWith = await callWithAppend(
            "extra instructions",
            mockServer.url,
        );
        await mockServer.close();
        mockServer = undefined;

        // Capture system content WITHOUT append.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('b')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const bodiesWithout = await callWithAppend(undefined, mockServer.url);

        /**
         * Extracts the system message content from a captured request body list.
         *
         * @param bodies - The captured request bodies.
         * @returns The system message content string.
         */
        function getSystemContent(
            bodies: Array<Record<string, unknown>>,
        ): string {
            const messages = bodies[0].messages as Array<{
                /** Message role. */
                role: string;
                /** Message content. */
                content: string;
            }>;
            return messages.find((m) => m.role === "system")?.content ?? "";
        }

        const withContent = getSystemContent(bodiesWith);
        const withoutContent = getSystemContent(bodiesWithout);

        expect(withContent).toContain("extra instructions");
        expect(withoutContent).not.toContain("extra instructions");
        // Without append the system prompt must be shorter.
        expect(withoutContent.length).toBeLessThan(withContent.length);
    });

    it("/dump_system_prompt includes appendSystemPrompt content in the dump file", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        const result = await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            appendSystemPrompt:
                "## Experiment notes\nSample is from patient cohort A.",
        });

        expect(result.text).toContain("System prompt dumped to");

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        // Both default and appended content must appear in the dump.
        expect(content).toContain("read_info");
        expect(content).toContain("Experiment notes");
        expect(content).toContain("patient cohort A");
    });

    it("/dump_system_prompt without appendSystemPrompt does not include appended content", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
        });

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("read_info");
        expect(content).not.toContain("Experiment notes");
    });
});

// Tests for --system-prompt CLI flag support via replaceSystemPrompt.
describe("replaceSystemPrompt", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "replace-prompt-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for replace-prompt tests. */
    const cfg: AiChatConfig = {
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
     * Calls handleUserMessage with the given replaceSystemPrompt and optional
     * appendSystemPrompt, then returns the captured LLM request bodies.
     *
     * @param replaceText - Text to replace the system prompt with, or undefined.
     * @param serverUrl - The mock server base URL.
     * @param appendText - Optional text to append after the base prompt.
     * @returns The captured LLM request bodies.
     */
    async function callWithReplace(
        replaceText: string | undefined,
        serverUrl: string,
        appendText?: string,
    ): Promise<Array<Record<string, unknown>>> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: replaceText,
            appendSystemPrompt: appendText,
        });
        return mockServer?.requestBodies() ?? [];
    }

    it("replaces the default sandbox prompt with the supplied text", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "You are a custom assistant.",
            mockServer.url,
        );

        expect(bodies.length).toBeGreaterThan(0);
        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemMsg = messages.find((m) => m.role === "system");
        expect(systemMsg).toBeDefined();
        // Replacement content must be present.
        expect(systemMsg?.content).toContain("You are a custom assistant.");
        // Default sandbox prompt content must NOT be present.
        expect(systemMsg?.content).not.toContain(
            "You are a Python REPL for bioinformatics analysis.",
        );
    });

    it("appendSystemPrompt still stacks on top of replaceSystemPrompt", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "Custom base prompt.",
            mockServer.url,
            "## Appended section\nExtra domain context.",
        );

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        expect(systemContent).toContain("Custom base prompt.");
        expect(systemContent).toContain("Appended section");
        // Appended text must follow the replacement base.
        const baseIdx = systemContent.indexOf("Custom base prompt.");
        const appendIdx = systemContent.indexOf("## Appended section");
        expect(baseIdx).toBeGreaterThan(-1);
        expect(appendIdx).toBeGreaterThan(baseIdx);
    });

    it("default sandbox prompt content is absent when replaceSystemPrompt is set", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(
            "Completely different instructions.",
            mockServer.url,
        );

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // Key phrases unique to the built-in sandbox prompt must not appear.
        expect(systemContent).not.toContain("Python REPL");
        expect(systemContent).not.toContain("bam_mods");
        expect(systemContent).not.toContain("continue_thinking");
    });

    it("when replaceSystemPrompt is undefined the default prompt is used", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('hi')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const bodies = await callWithReplace(undefined, mockServer.url);

        const messages = bodies[0].messages as Array<{
            /** Message role. */
            role: string;
            /** Message content. */
            content: string;
        }>;
        const systemContent =
            messages.find((m) => m.role === "system")?.content ?? "";

        // Default sandbox prompt content must be present.
        expect(systemContent).toContain("Python REPL");
        expect(systemContent).toContain("bam_mods");
    });

    it("/dump_system_prompt writes replacement content, not the default sandbox prompt", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        const result = await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: "Custom prompt for dump test.",
        });

        expect(result.text).toContain("System prompt dumped to");

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("Custom prompt for dump test.");
        // Default sandbox prompt content must not appear.
        expect(content).not.toContain("Python REPL");
    });

    it("/dump_system_prompt includes both replacement and appended content", async () => {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];

        await handleUserMessage({
            message: "/dump_system_prompt",
            endpointUrl: "http://localhost:1234/v1",
            apiKey: "",
            model: "test",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            replaceSystemPrompt: "Replacement base.",
            appendSystemPrompt: "Appended section.",
        });

        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        const content = await readFile(join(outputDir, files[0]), "utf-8");

        expect(content).toContain("Replacement base.");
        expect(content).toContain("Appended section.");
        // Replacement must precede the append.
        expect(content.indexOf("Replacement base.")).toBeLessThan(
            content.indexOf("Appended section."),
        );
        // Default sandbox content must not appear.
        expect(content).not.toContain("Python REPL");
    });
});

// Tests for the --rm-tools CLI flag support via removedTools.
describe("removedTools", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "rm-tools-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for removedTools tests. */
    const cfg: AiChatConfig = {
        contextWindowTokens: 8192,
        maxRetries: 1,
        timeoutSeconds: 30,
        maxRecordsReadInfo: 100,
        maxRecordsBamMods: 100,
        maxRecordsWindowReads: 100,
        maxRecordsSeqTable: 100,
        maxCodeRounds: 3,
        maxDurationSecs: 600,
        maxMemoryMB: 512,
        maxAllocations: 100_000,
        maxReadMB: 1,
        maxWriteMB: 50,
    };

    it("removed tool causes a sandbox error when LLM tries to call it", async () => {
        // First LLM turn: generate code that calls the removed tool.
        // Second LLM turn: produce a plain-text final answer.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "```python\npeek('test.bam')\n```",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "peek is not available.",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            removedTools: new Set(["peek"]),
        });

        // The sandbox execution should have failed because peek was removed.
        expect(result.steps.length).toBeGreaterThan(0);
        expect(result.steps[0].result.success).toBe(false);
    });

    it("non-removed tools still work when removedTools is provided", async () => {
        // First LLM turn: generate code that calls ls() (not removed).
        // Second LLM turn: produce a plain-text final answer.
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "```python\nls()\n```",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "Done.",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            facts,
            signal: new AbortController().signal,
            removedTools: new Set(["peek"]),
        });

        // ls() is not removed, so the sandbox step should succeed.
        expect(result.steps.length).toBeGreaterThan(0);
        expect(result.steps[0].result.success).toBe(true);
    });
});
