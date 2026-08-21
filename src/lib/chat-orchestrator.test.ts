// Unit tests for chat orchestrator pure functions and adversarial edge cases.
// Tests pruneFailedRounds, context pipeline, runSandboxGuarded, and adversarial edge cases.
// handleUserMessage end-to-end tests live in chat-orchestrator-handle-message.test.ts.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    applySlidingWindow,
    deriveHistoryBudgetTokens,
    extractCodeFromFences,
    getLastSentMessages,
    handleUserMessage,
    pruneFailedRounds,
    resetLastSentMessages,
    runSandboxGuarded,
    transformContext,
} from "./chat-orchestrator";
import {
    type MockCompletion,
    type MockServer,
    startMockServer,
} from "./chat-orchestrator-test-utils";
import type { AiChatConfig, AiChatEvent, HistoryEntry } from "./chat-types";

describe("pruneFailedRounds", () => {
    it("drops old failed rounds but keeps the most recent one", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "How many reads?" },
            { role: "assistant", content: "x = bad_code1" },
            {
                role: "user",
                content: 'Code execution result: {"success":false}',
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "x = bad_code2" },
            {
                role: "user",
                content: 'Code execution result: {"success":false}',
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "print('good')" },
            {
                role: "user",
                content: 'Code execution result: {"success":true}',
                isExecutionResult: true,
                executionStatus: "ok",
            },
            { role: "assistant", content: "There are 42 reads." },
        ];
        const pruned = pruneFailedRounds(history);
        // First failed pair removed, second (most recent) kept
        expect(pruned).toHaveLength(6);
        expect(pruned.some((m) => m.content === "x = bad_code1")).toBe(false);
        expect(pruned.some((m) => m.content === "x = bad_code2")).toBe(true);
    });

    it("keeps the only failed round (it is the most recent)", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "How many reads?" },
            { role: "assistant", content: "x = bad_code" },
            {
                role: "user",
                content: 'Code execution result: {"success":false}',
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "print('good')" },
            {
                role: "user",
                content: 'Code execution result: {"success":true}',
                isExecutionResult: true,
                executionStatus: "ok",
            },
            { role: "assistant", content: "There are 42 reads." },
        ];
        const pruned = pruneFailedRounds(history);
        // Single failed pair is the most recent — kept
        expect(pruned).toHaveLength(6);
        expect(pruned.some((m) => m.content === "x = bad_code")).toBe(true);
    });

    it("preserves all-successful rounds unchanged", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Count reads" },
            { role: "assistant", content: "print(100)" },
            {
                role: "user",
                content: 'Code execution result: {"success":true}',
                isExecutionResult: true,
                executionStatus: "ok",
            },
            { role: "assistant", content: "100 reads." },
        ];
        const pruned = pruneFailedRounds(history);
        expect(pruned).toHaveLength(4);
    });

    it("handles turns with no execution results", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
        ];
        const pruned = pruneFailedRounds(history);
        expect(pruned).toHaveLength(2);
    });

    it("prunes all but most recent consecutive failed round", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "query" },
            { role: "assistant", content: "bad1" },
            {
                role: "user",
                content: "error1",
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "bad2" },
            {
                role: "user",
                content: "error2",
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "print('ok')" },
        ];
        const pruned = pruneFailedRounds(history);
        // First failed pair pruned, second (most recent) kept, plus query + final
        expect(pruned).toHaveLength(4);
        expect(pruned[0].content).toBe("query");
        expect(pruned[1].content).toBe("bad2");
        expect(pruned[2].content).toBe("error2");
        expect(pruned[3].content).toBe("print('ok')");
    });

    it("does not prune user messages without executionStatus", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "print('hi')" },
            { role: "user", content: "Another question" },
        ];
        const pruned = pruneFailedRounds(history);
        expect(pruned).toHaveLength(3);
    });
});

describe("applySlidingWindow", () => {
    it("keeps all messages when within budget", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
        ];
        const result = applySlidingWindow(history, 10000);
        expect(result).toHaveLength(2);
    });

    it("drops older messages when over budget", () => {
        const history: HistoryEntry[] = Array.from({ length: 100 }, (_, i) => ({
            role: "user" as const,
            content: `Message ${i} ${"x".repeat(200)}`,
        }));
        const result = applySlidingWindow(history, 1000);
        expect(result.length).toBeLessThan(100);
        expect(result.length).toBeGreaterThan(0);
        // Should keep the latest messages
        expect(result[result.length - 1].content).toContain("Message 99");
    });

    it("uses smaller bytes-per-token estimates to keep fewer messages", () => {
        // Each message here is ~210 UTF-8 bytes, so with a 1000-token window
        // about 18 messages fit at 4 bytes/token, while only about 9 fit at
        // 2 bytes/token.
        const history: HistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
            role: "user" as const,
            content: `Message ${i} ${"x".repeat(200)}`,
        }));
        const uncalibrated = applySlidingWindow(history, 1000, 4);
        const calibrated = applySlidingWindow(history, 1000, 2);
        expect(uncalibrated.length).toBeGreaterThan(1);
        expect(
            uncalibrated.map(
                (entry) => entry.content.match(/Message \d+/)?.[0],
            ),
        ).toEqual([
            "Message 2",
            "Message 3",
            "Message 4",
            "Message 5",
            "Message 6",
            "Message 7",
            "Message 8",
            "Message 9",
            "Message 10",
            "Message 11",
            "Message 12",
            "Message 13",
            "Message 14",
            "Message 15",
            "Message 16",
            "Message 17",
            "Message 18",
            "Message 19",
        ]);
        expect(calibrated.length).toBeLessThan(uncalibrated.length);
        expect(
            calibrated.map((entry) => entry.content.match(/Message \d+/)?.[0]),
        ).toEqual([
            "Message 11",
            "Message 12",
            "Message 13",
            "Message 14",
            "Message 15",
            "Message 16",
            "Message 17",
            "Message 18",
            "Message 19",
        ]);
    });

    it("returns only the newest message when budget is zero", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
        ];
        const result = applySlidingWindow(history, 0);
        expect(result).toEqual([{ role: "assistant", content: "Hi" }]);
    });

    it("returns an empty array when budget is zero and history is empty", () => {
        expect(applySlidingWindow([], 0)).toEqual([]);
    });
});

describe("deriveHistoryBudgetTokens", () => {
    it("reserves tokens for the system prompt and completion", () => {
        const systemPrompt = "x".repeat(4000);
        expect(deriveHistoryBudgetTokens(10000, systemPrompt, 4096, 4)).toBe(
            4904,
        );
    });

    it("never returns less than one token", () => {
        const systemPrompt = "x".repeat(100000);
        expect(deriveHistoryBudgetTokens(1000, systemPrompt, 4096, 4)).toBe(1);
    });
});

describe("transformContext", () => {
    it("combines pruning and sliding window", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "test" },
            { role: "assistant", content: "bad_code_old" },
            {
                role: "user",
                content: "error_old",
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "bad_code_recent" },
            {
                role: "user",
                content: "error_recent",
                isExecutionResult: true,
                executionStatus: "error",
            },
            { role: "assistant", content: "Done" },
        ];
        const result = transformContext(history, {
            contextBudgetTokens: 10000,
        });
        // Old failed round should be pruned, most recent kept
        expect(result.some((m) => m.content === "bad_code_old")).toBe(false);
        expect(result.some((m) => m.content === "error_old")).toBe(false);
        expect(result.some((m) => m.content === "bad_code_recent")).toBe(true);
        expect(result.some((m) => m.content === "error_recent")).toBe(true);
    });
});

describe("extractCodeFromFences", () => {
    it("extracts code from python fences", () => {
        const response = "Here's the code:\n\n```python\nprint('hello')\n```";
        expect(extractCodeFromFences(response)).toBe("print('hello')");
    });

    it("extracts code from bare fences", () => {
        const response = "Here:\n\n```\nprint('hello')\n```";
        expect(extractCodeFromFences(response)).toBe("print('hello')");
    });

    it("concatenates multiple fenced blocks", () => {
        const response =
            "First:\n\n```python\nx = 1\n```\n\nSecond:\n\n```python\nprint(x + 1)\n```";
        expect(extractCodeFromFences(response)).toBe("x = 1\n\nprint(x + 1)");
    });

    it("returns null when no fences found", () => {
        expect(extractCodeFromFences("just plain text")).toBeNull();
    });

    it("handles case-variant fence tags", () => {
        const response = "```Python\nprint('hello')\n```";
        expect(extractCodeFromFences(response)).toBe("print('hello')");
    });

    it("handles py fence tag", () => {
        const response = "```py\nprint('hello')\n```";
        expect(extractCodeFromFences(response)).toBe("print('hello')");
    });
});

describe("runSandboxGuarded", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "sandbox-guard-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("returns correct result for simple code", async () => {
        const result = await runSandboxGuarded("1 + 1", tmpDir, {});
        expect(result.success).toBe(true);
        expect(result.value).toBe(2);
    });

    it("serializes concurrent sandbox calls", async () => {
        const [r1, r2] = await Promise.all([
            runSandboxGuarded("1 + 1", tmpDir, {}),
            runSandboxGuarded("2 + 2", tmpDir, {}),
        ]);
        expect(r1.success).toBe(true);
        expect(r1.value).toBe(2);
        expect(r2.success).toBe(true);
        expect(r2.value).toBe(4);
    });

    it("throws abort error when signal is already aborted and lock is free", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            runSandboxGuarded("1 + 1", tmpDir, {}, controller.signal),
        ).rejects.toThrow();
    });
});

/** Minimal AI chat config for adversarial tests. */
const minimalConfig: AiChatConfig = {
    contextWindowTokens: 32000,
    maxRetries: 2,
    timeoutSeconds: 30,
    maxCodeRounds: 10,
    maxRecordsReadInfo: 100,
    maxRecordsBamMods: 100,
    maxRecordsWindowReads: 100,
    maxRecordsSeqTable: 100,
    maxDurationSecs: 600,
    maxMemoryMB: 512,
    maxAllocations: 100_000,
    maxReadMB: 1,
    maxWriteMB: 50,
};

describe("adversarial/edge-case tests", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "adversarial-"));
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Calls handleUserMessage with the given mock server URL.
     *
     * @param serverUrl - The mock server base URL.
     * @param options - Optional overrides.
     * @param options.message - The user message.
     * @param options.signal - Abort signal.
     * @param options.config - Config overrides.
     * @param options.appendSystemPrompt - Optional text to append to the system prompt.
     * @returns The orchestrator result, history, and events.
     */
    async function callOrchestrator(
        serverUrl: string,
        options: {
            /** User message. */
            message?: string;
            /** Abort signal. */
            signal?: AbortSignal;
            /** Config overrides. */
            config?: Partial<AiChatConfig>;
            /** Optional text to append to the system prompt. */
            appendSystemPrompt?: string;
        } = {},
    ): Promise<{
        /** Orchestrator return value. */
        result: Awaited<ReturnType<typeof handleUserMessage>>;
        /** History after call. */
        history: HistoryEntry[];
        /** Events emitted. */
        events: AiChatEvent[];
    }> {
        const history: HistoryEntry[] = [];
        const events: AiChatEvent[] = [];

        const result = await handleUserMessage({
            message: options.message ?? "test",
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: { ...minimalConfig, ...options.config },
            /**
             * Collects emitted events for test assertions.
             *
             * @param e - The event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            signal: options.signal ?? new AbortController().signal,
            appendSystemPrompt: options.appendSystemPrompt,
        });

        return { result, history, events };
    }

    it("throws SyntaxError immediately on malformed JSON 200 response", async () => {
        const responses: MockCompletion[] = [
            {
                choices: [],
                _rawBody: "not json at all",
            },
        ];
        mockServer = await startMockServer(responses);

        await expect(callOrchestrator(mockServer.url)).rejects.toThrow(
            SyntaxError,
        );
        // Should not retry — only 1 request
        expect(mockServer.requestCount()).toBe(1);
    });

    it("throws immediately on non-retryable 4xx errors", async () => {
        for (const status of [400, 401, 403, 422]) {
            const responses: MockCompletion[] = [
                { choices: [], _statusCode: status },
            ];
            const server = await startMockServer(responses);

            await expect(callOrchestrator(server.url)).rejects.toThrow(
                `HTTP ${status}`,
            );
            // Should not retry — only 1 request
            expect(server.requestCount()).toBe(1);

            await server.close();
        }
    });

    it("includes Ollama guidance in 404 error message", async () => {
        const responses: MockCompletion[] = [{ choices: [], _statusCode: 404 }];
        mockServer = await startMockServer(responses);

        try {
            await callOrchestrator(mockServer.url);
            expect.unreachable("Should have thrown");
        } catch (e) {
            expect((e as Error).message).toContain("Ollama");
            expect((e as Error).message).toContain("/v1");
        }
    });

    it("propagates abort during retry sleep", async () => {
        const responses: MockCompletion[] = [
            { choices: [], _statusCode: 500 },
            {
                choices: [
                    {
                        message: { role: "assistant", content: "print('ok')" },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const controller = new AbortController();
        // Abort after 200ms — during the retry backoff sleep
        setTimeout(() => controller.abort(), 200);

        await expect(
            callOrchestrator(mockServer.url, { signal: controller.signal }),
        ).rejects.toThrow();
    });

    it("forced-final with continue_thinking still produces terminal output", async () => {
        const responses: MockCompletion[] = [
            // Round 1: continue_thinking (exhausts maxRounds=1)
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            // Forced-final: also calls continue_thinking
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: 'continue_thinking()\nprint("forced")',
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url, {
            config: { maxCodeRounds: 1 },
        });

        // Even though continue_thinking was called, forced-final treats output as terminal
        expect(result.text).toContain("forced");
    });

    it("stops executing code after the cumulative sandbox budget is exhausted", async () => {
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
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
                            content: 'print("must not execute")',
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);
        const nowSpy = vi
            .spyOn(Date, "now")
            // First response timestamp, then sandbox execution start/end.
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(30 * 60 * 1000)
            .mockReturnValue(30 * 60 * 1000);

        try {
            const { result, history, events } = await callOrchestrator(
                mockServer.url,
                { config: { maxCodeRounds: 3 } },
            );

            expect(mockServer.requestCount()).toBe(2);
            expect(result.steps).toHaveLength(1);
            expect(result.text).toBe(
                "(Sandbox execution budget exhausted. The model's response could not be executed.)",
            );
            expect(
                events.filter((event) => event.type === "code_execution_start"),
            ).toHaveLength(1);
            expect(
                history.some((entry) =>
                    entry.content.includes(
                        "Maximum cumulative sandbox runtime exceeded",
                    ),
                ),
            ).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("forced-final with finish_reason length pushes rawFinal to history", async () => {
        const responses: MockCompletion[] = [
            // Round 1: continue_thinking (exhausts maxRounds=1)
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            // Forced-final: truncated by token limit
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('truncated",
                        },
                        finish_reason: "length",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { history } = await callOrchestrator(mockServer.url, {
            config: { maxCodeRounds: 1 },
        });

        // The truncated raw response should have been pushed to history
        const last = history[history.length - 1];
        expect(last.role).toBe("assistant");
        expect(last.content).toBe("print('truncated");
    });

    it("forced-final rejects malformed native tool markup", async () => {
        const malformedResponse =
            '<tool_calls><invoke name="ls"></invoke></tool_calls>';
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
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
                            content: malformedResponse,
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result, history, events } = await callOrchestrator(
            mockServer.url,
            { config: { maxCodeRounds: 1 } },
        );

        expect(result.text).toContain("did not produce a usable response");
        expect(
            events.filter((event) => event.type === "code_execution_start"),
        ).toHaveLength(1);
        expect(history).toContainEqual({
            role: "assistant",
            content: malformedResponse,
        });
        expect(history.at(-1)?.content).toContain("MalformedAssistantProtocol");
    });

    it("forced-final fence-extraction retry on SyntaxError", async () => {
        const responses: MockCompletion[] = [
            // Round 1: continue_thinking (exhausts maxRounds=1)
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            // Forced-final: code wrapped in markdown fences (causes SyntaxError if run raw)
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "```python\nprint('extracted')\n```",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url, {
            config: { maxCodeRounds: 1 },
        });

        // The extracted code should have run and produced output
        expect(result.text).toContain("extracted");
    });

    it("valid Python with backtick strings executes directly", async () => {
        // Code that contains backtick-like strings but is valid Python
        const code = 'x = "```python\\nhello\\n```"\nprint(x)';
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: { role: "assistant", content: code },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        // Should execute directly without fence extraction interfering
        expect(result.text).toContain("```python");
    });

    it("stores request and response in lastSentMessages after LLM call", async () => {
        resetLastSentMessages();
        const responses: MockCompletion[] = [
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
        ];
        mockServer = await startMockServer(responses);

        await callOrchestrator(mockServer.url);

        const stored = getLastSentMessages();
        expect(stored).not.toBeNull();
        // First message is the system prompt
        expect(stored?.[0].role).toBe("system");
        // Second-to-last is the exec result feedback (user message)
        expect(stored?.[stored.length - 2].role).toBe("user");
        expect(stored?.[stored.length - 2].content).toContain(
            "Code execution result:",
        );
        // Last message is the user-facing final answer
        expect(stored?.[stored.length - 1].role).toBe("assistant");
        expect(stored?.[stored.length - 1].content).toBe("ok\n");
    });

    it("lastSentMessages includes assistant response from forced-final path", async () => {
        resetLastSentMessages();
        const responses: MockCompletion[] = [
            // Round 1: continue_thinking (exhausts maxRounds=1)
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "continue_thinking()\n42",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            // Forced-final response
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('final answer')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        await callOrchestrator(mockServer.url, {
            config: { maxCodeRounds: 1 },
        });

        const stored = getLastSentMessages();
        expect(stored).not.toBeNull();
        // Last message should be the forced-final assistant response
        expect(stored?.[stored.length - 1].role).toBe("assistant");
        expect(stored?.[stored.length - 1].content).toBe(
            "print('final answer')",
        );
    });

    it("429 with Retry-After header respects the delay", async () => {
        const responses: MockCompletion[] = [
            {
                choices: [],
                _statusCode: 429,
                _headers: { "Retry-After": "1" },
            },
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
        ];
        mockServer = await startMockServer(responses);

        const start = performance.now();
        const { result } = await callOrchestrator(mockServer.url);
        const elapsed = performance.now() - start;

        expect(result.text).toBe("ok\n");
        // Retry-After: 1 means 1 second delay; 500 ms lower bound gives
        // generous slack for scheduling jitter while still catching any code
        // path that skips the sleep entirely (which would complete in < 5 ms).
        expect(elapsed).toBeGreaterThanOrEqual(500);
        expect(mockServer.requestCount()).toBeGreaterThanOrEqual(2);
    });

    it("feedback prints exceeding FEEDBACK_OUTPUT_MAX_BYTES are truncated", async () => {
        // First round: huge print + continue_thinking
        // Second round: final answer
        const bigPrint = "x".repeat(12000);
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: `print("${bigPrint}")\ncontinue_thinking()`,
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
                            content: "print('done')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { history } = await callOrchestrator(mockServer.url);

        const feedbackMsg = history.find(
            (m) =>
                m.role === "user" &&
                "isExecutionResult" in m &&
                m.isExecutionResult &&
                m.content.includes("truncated"),
        );
        expect(feedbackMsg).toBeDefined();
        const parsed = JSON.parse(
            feedbackMsg?.content.replace("Code execution result: ", "") ?? "",
        ) as Record<string, unknown>;
        expect(parsed.truncated).toBe(true);
    });

    it("error feedback includes print output when code fails after printing", async () => {
        const responses: MockCompletion[] = [
            // Round 1: prints something then raises an error
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content:
                                'print("before error")\nraise ValueError("boom")',
                        },
                        finish_reason: "stop",
                    },
                ],
            },
            // Round 2: final answer after seeing the error feedback
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: 'print("done")',
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { history } = await callOrchestrator(mockServer.url, {
            config: { maxCodeRounds: 2 },
        });

        // Find the error feedback message sent back to the LLM
        const feedbackMsg = history.find(
            (m) =>
                m.role === "user" &&
                "isExecutionResult" in m &&
                m.isExecutionResult &&
                m.content.includes("before error"),
        );
        expect(feedbackMsg).toBeDefined();
        const parsed = JSON.parse(
            feedbackMsg?.content.replace("Code execution result: ", ""),
        ) as Record<string, unknown>;
        expect(parsed.success).toBe(false);
        expect(parsed.prints).toBe("before error\n");
    });

    it("includes temperature in request body when set", async () => {
        const responses: MockCompletion[] = [
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
        ];
        mockServer = await startMockServer(responses);

        await callOrchestrator(mockServer.url, {
            config: { temperature: 0.7 },
        });

        const bodies = mockServer.requestBodies();
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies[0].temperature).toBe(0.7);
    });

    it("omits temperature from request body when undefined", async () => {
        const responses: MockCompletion[] = [
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
        ];
        mockServer = await startMockServer(responses);

        await callOrchestrator(mockServer.url);

        const bodies = mockServer.requestBodies();
        expect(bodies.length).toBeGreaterThan(0);
        expect("temperature" in bodies[0]).toBe(false);
    });

    it("SyntaxError feedback includes hint field inside JSON", async () => {
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "this is not python at all!",
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
                            content: "print('fixed')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { history } = await callOrchestrator(mockServer.url);

        const syntaxFeedback = history.find(
            (m) =>
                m.role === "user" &&
                m.content.includes("SyntaxError") &&
                m.content.includes("hint"),
        );
        expect(syntaxFeedback).toBeDefined();
        const parsed = JSON.parse(
            syntaxFeedback?.content.replace("Code execution result: ", "") ??
                "",
        ) as Record<string, unknown>;
        expect(parsed.hint).toContain("not valid Python");
        expect(parsed.error_type).toBe("SyntaxError");
    });
});

describe("startMockServer utility", () => {
    it("falls back to HTTP 500 when started with an empty responses array", async () => {
        const server = await startMockServer([]);
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
        });
        await server.close();
        expect(res.status).toBe(500);
    });

    it("returns HTTP 404 for requests to non-matching routes", async () => {
        const server = await startMockServer([]);
        const res = await fetch(`${server.url}/other`, { method: "GET" });
        await server.close();
        expect(res.status).toBe(404);
    });

    it("honours _delayMs by responding after the specified delay", async () => {
        const server = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "ok" },
                        finish_reason: "stop",
                    },
                ],
                _delayMs: 50,
            },
        ]);
        const start = performance.now();
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
        });
        const elapsed = performance.now() - start;
        await server.close();
        expect(res.status).toBe(200);
        expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("ignores non-JSON client request bodies without throwing", async () => {
        const server = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "ok" },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);
        const res = await fetch(`${server.url}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "not json",
        });
        await server.close();
        expect(res.status).toBe(200);
    });
});
