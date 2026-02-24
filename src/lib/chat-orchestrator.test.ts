// Unit tests for chat orchestrator functions.
// Tests pruneFailedRounds, facts extraction, context pipeline, /exec slash command, and adversarial edge cases.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    addFact,
    applySlidingWindow,
    evictFacts,
    extractCodeFromFences,
    extractFacts,
    handleUserMessage,
    pruneFailedRounds,
    renderFactsBlock,
    runSandboxGuarded,
    transformContext,
} from "./chat-orchestrator";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
} from "./chat-types";

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

describe("addFact", () => {
    it("adds a new fact", () => {
        const facts: Fact[] = [];
        addFact(facts, {
            type: "file",
            filename: "test.bam",
            roundId: "round-1",
            timestamp: 1000,
        });
        expect(facts).toHaveLength(1);
    });

    it("replaces fact with same key", () => {
        const facts: Fact[] = [
            {
                type: "file",
                filename: "test.bam",
                roundId: "round-1",
                timestamp: 1000,
            },
        ];
        addFact(facts, {
            type: "file",
            filename: "test.bam",
            roundId: "round-2",
            timestamp: 2000,
        });
        expect(facts).toHaveLength(1);
        expect(facts[0].roundId).toBe("round-2");
    });
});

describe("evictFacts", () => {
    it("does not evict when under limit", () => {
        const facts: Fact[] = [
            {
                type: "file",
                filename: "test.bam",
                roundId: "round-1",
                timestamp: 1000,
            },
        ];
        evictFacts(facts);
        expect(facts).toHaveLength(1);
    });

    it("evicts oldest filter facts when over limit", () => {
        const facts: Fact[] = [];
        // Add many filter facts to exceed 2KB
        for (let i = 0; i < 50; i++) {
            facts.push({
                type: "filter",
                description: `filter_${i}_${"x".repeat(50)}`,
                roundId: `round-${i}`,
                timestamp: i,
            });
        }
        evictFacts(facts);
        expect(facts.length).toBeLessThan(50);
    });

    it("evicts oldest file facts after exhausting filter facts", () => {
        const facts: Fact[] = [];
        // Add many file facts (no filter facts) to exceed 2KB
        for (let i = 0; i < 50; i++) {
            facts.push({
                type: "file",
                filename: `sample_${i}_${"x".repeat(50)}.bam`,
                roundId: `round-${i}`,
                timestamp: i,
            });
        }
        evictFacts(facts);
        expect(facts.length).toBeLessThan(50);
        // Oldest should be evicted first — remaining should have higher timestamps
        const timestamps = facts.map((f) => f.timestamp);
        expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it("preserves output facts during eviction", () => {
        const facts: Fact[] = [
            {
                type: "output",
                path: "ai_chat_output/results.bed",
                roundId: "round-0",
                timestamp: 0,
            },
        ];
        // Add many filter facts
        for (let i = 0; i < 50; i++) {
            facts.push({
                type: "filter",
                description: `filter_${i}_${"x".repeat(50)}`,
                roundId: `round-${i + 1}`,
                timestamp: i + 1,
            });
        }
        evictFacts(facts);
        const outputFact = facts.find((f) => f.type === "output");
        expect(outputFact).toBeDefined();
    });
});

describe("renderFactsBlock", () => {
    it("returns empty string for no facts", () => {
        expect(renderFactsBlock([])).toBe("");
    });

    it("renders facts as JSON block", () => {
        const facts: Fact[] = [
            {
                type: "file",
                filename: "test.bam",
                roundId: "round-1",
                timestamp: 1000,
            },
        ];
        const block = renderFactsBlock(facts);
        expect(block).toContain("Conversation facts");
        expect(block).toContain("test.bam");
        expect(block).toContain("```json");
        // Should not include internal fields
        expect(block).not.toContain("roundId");
        expect(block).not.toContain("timestamp");
    });
});

describe("extractFacts", () => {
    it("extracts file facts from successful result", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: true, value: 42 },
            { code: 'x = read_info("test.bam")' },
            "round-1",
            facts,
        );
        expect(facts).toHaveLength(1);
        expect(facts[0].type).toBe("file");
        const fileFact = facts[0] as { /** Filename. */ filename: string };
        expect(fileFact.filename).toBe("test.bam");
    });

    it("skips extraction for failed results", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: false, errorType: "RuntimeError", message: "bad" },
            { code: 'x = read_info("test.bam")' },
            "round-1",
            facts,
        );
        expect(facts).toHaveLength(0);
    });

    it("extracts filter facts from kwargs in successful result", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: true, value: "ok" },
            { code: 'window_reads("f.bam", region="chr1:1-100")' },
            "round-1",
            facts,
        );
        const filterFact = facts.find((f) => f.type === "filter");
        expect(filterFact).toBeDefined();
        const desc = (filterFact as { /** Desc. */ description: string })
            .description;
        expect(desc).toContain("region=chr1:1-100");
    });

    it("does not extract filter facts from failed result", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: false, errorType: "RuntimeError", message: "bad" },
            { code: 'window_reads("f.bam", region="chr1:1-100")' },
            "round-1",
            facts,
        );
        expect(facts).toHaveLength(0);
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

// --- Mock server infrastructure for adversarial tests ---

/** A mock completion response matching the OpenAI chat completions format. */
interface MockCompletion {
    /** The response choices array. */
    choices: Array<{
        /** The assistant message. */
        message: {
            /** The message role. */
            role: string;
            /** The text content. */
            content?: string | null;
        };
        /** The reason generation stopped. */
        finish_reason: string;
    }>;
    /** Override HTTP status code (default 200). */
    _statusCode?: number;
    /** Delay in ms before responding. */
    _delayMs?: number;
    /** Custom response headers (e.g. Retry-After). */
    _headers?: Record<string, string>;
    /** Return raw body instead of JSON (for malformed response tests). */
    _rawBody?: string;
}

/** Return type of startMockServer. */
interface MockServer {
    /** The base URL (e.g., http://127.0.0.1:PORT/v1). */
    url: string;
    /** Closes the mock server. */
    close: () => Promise<void>;
    /** Returns the number of requests handled so far. */
    requestCount: () => number;
    /** Returns the captured request bodies in order. */
    requestBodies: () => Array<Record<string, unknown>>;
}

/**
 * Starts a local HTTP server that returns queued OpenAI-compatible responses.
 *
 * @param responses - Queue of response entries to return in sequence.
 * @returns The mock server URL, close function, and request counter.
 */
async function startMockServer(
    responses: MockCompletion[],
): Promise<MockServer> {
    let idx = 0;
    const capturedBodies: Array<Record<string, unknown>> = [];

    /**
     * Handles incoming HTTP requests by returning queued responses.
     *
     * @param req - The incoming HTTP request.
     * @param res - The server response.
     */
    function handler(req: IncomingMessage, res: ServerResponse): void {
        if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                try {
                    const body = JSON.parse(
                        Buffer.concat(chunks).toString("utf-8"),
                    ) as Record<string, unknown>;
                    capturedBodies.push(body);
                } catch {
                    // Non-JSON body — ignore
                }
                const completion =
                    idx < responses.length
                        ? responses[idx]
                        : responses[responses.length - 1];
                idx++;
                const statusCode = completion._statusCode ?? 200;
                const delayMs = completion._delayMs ?? 0;

                /**
                 * Sends the HTTP response with the completion body.
                 */
                const sendResponse = (): void => {
                    res.writeHead(statusCode, {
                        "Content-Type": "application/json",
                        ...(completion._headers ?? {}),
                    });
                    if (completion._rawBody !== undefined) {
                        res.end(completion._rawBody);
                    } else {
                        res.end(
                            JSON.stringify({
                                id: `chatcmpl-${idx}`,
                                object: "chat.completion",
                                created: Math.floor(Date.now() / 1000),
                                model: "test-model",
                                ...completion,
                            }),
                        );
                    }
                };

                if (delayMs > 0) {
                    setTimeout(sendResponse, delayMs);
                } else {
                    sendResponse();
                }
            });
        } else {
            res.writeHead(404);
            res.end("Not found");
        }
    }

    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const addr = server.address();
    if (addr === null || typeof addr === "string") {
        throw new Error("Mock server did not bind to a port");
    }
    return {
        url: `http://127.0.0.1:${addr.port}/v1`,
        /** Closes the server and resolves when done. */
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
            }),
        /**
         * Returns the number of requests handled.
         *
         * @returns The request count.
         */
        requestCount: () => idx,
        /**
         * Returns the captured request bodies in order.
         *
         * @returns The request body array.
         */
        requestBodies: () => capturedBodies,
    };
}

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
     * @returns The orchestrator result, history, facts, and events.
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
        } = {},
    ): Promise<{
        /** Orchestrator return value. */
        result: Awaited<ReturnType<typeof handleUserMessage>>;
        /** History after call. */
        history: HistoryEntry[];
        /** Facts after call. */
        facts: Fact[];
        /** Events emitted. */
        events: AiChatEvent[];
    }> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
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
            facts,
            signal: options.signal ?? new AbortController().signal,
        });

        return { result, history, facts, events };
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

        const start = Date.now();
        const { result } = await callOrchestrator(mockServer.url);
        const elapsed = Date.now() - start;

        expect(result.text).toBe("ok\n");
        // Retry-After: 1 means 1 second delay
        expect(elapsed).toBeGreaterThanOrEqual(900);
        expect(mockServer.requestCount()).toBeGreaterThanOrEqual(2);
    });

    it("feedback prints exceeding FEEDBACK_OUTPUT_MAX_BYTES are truncated", async () => {
        // First round: huge print + continue_thinking
        // Second round: final answer
        const bigPrint = "x".repeat(5000);
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
});
