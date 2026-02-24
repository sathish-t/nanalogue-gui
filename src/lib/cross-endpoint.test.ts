// Cross-endpoint compatibility tests for the chat orchestrator.
// Verifies handleUserMessage works with the code-only loop against a mock LLM server.

import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserMessage } from "./chat-orchestrator";
import type {
    AiChatConfig,
    AiChatEvent,
    Fact,
    HistoryEntry,
} from "./chat-types";

/** Directory containing cross-endpoint test fixture JSON files. */
const FIXTURES_DIR = join(__dirname, "../../tests/fixtures/mock-llm-responses");

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
    /** Override HTTP status code (default 200). Used to simulate server errors. */
    _statusCode?: number;
    /** Delay in ms before responding. Used to test cancellation. */
    _delayMs?: number;
    /** Custom response headers to send (e.g., Retry-After for 429 tests). */
    _headers?: Record<string, string>;
}

/** Expected result for a single execution step. */
interface FixtureExpectedStep {
    /** Whether the step succeeded. */
    success: boolean;
    /** The computed value (omitted for failed steps). */
    value?: number;
}

/** Expected results loaded from a fixture JSON file. */
interface FixtureExpected {
    /** The expected response text. */
    text: string;
    /** The expected number of steps. */
    stepCount: number;
    /** Per-step expected results. */
    steps: Array<FixtureExpectedStep>;
    /** Minimum number of requests the server should have received. */
    minRequestCount?: number;
}

/** Shape of a fixture JSON file. */
interface FixtureFile {
    /** Mock responses to queue. */
    mockResponses: Array<MockCompletion>;
    /** Expected test results. */
    expected: FixtureExpected;
}

/** Parsed fixture data ready for use in a test. */
interface LoadedFixture {
    /** The response entries to queue on the mock server. */
    responses: MockCompletion[];
    /** The expected test results. */
    expected: FixtureExpected;
}

/**
 * Loads a fixture JSON file.
 *
 * @param name - The fixture file name (without extension).
 * @returns The parsed responses array and expected results.
 */
function loadFixture(name: string): LoadedFixture {
    const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8");
    const fixture = JSON.parse(raw) as FixtureFile;
    return { responses: fixture.mockResponses, expected: fixture.expected };
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
                    res.end(
                        JSON.stringify({
                            id: `chatcmpl-${idx}`,
                            object: "chat.completion",
                            created: Math.floor(Date.now() / 1000),
                            model: "test-model",
                            ...completion,
                            usage: {
                                prompt_tokens: 10,
                                completion_tokens: 10,
                                total_tokens: 20,
                            },
                        }),
                    );
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

/** Minimal AI chat config for cross-endpoint tests. */
const minimalConfig: AiChatConfig = {
    contextWindowTokens: 32000,
    maxRetries: 2,
    timeoutSeconds: 30,
    maxCodeRounds: 10,
    // temperature intentionally omitted (optional, defaults to undefined)
    maxRecordsReadInfo: 100,
    maxRecordsBamMods: 100,
    maxRecordsWindowReads: 100,
    maxRecordsSeqTable: 100,
    maxDurationSecs: 600,
    maxMemoryMB: 512,
    maxAllocations: 100_000,
};

/** Orchestrator call result for test assertions. */
interface OrchestratorTestResult {
    /** The orchestrator return value. */
    result: Awaited<ReturnType<typeof handleUserMessage>>;
    /** The conversation history after the call. */
    history: HistoryEntry[];
    /** The facts array after the call. */
    facts: Fact[];
    /** The events emitted during the call. */
    events: AiChatEvent[];
}

describe("cross-endpoint compatibility", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "cross-endpoint-"));
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
     * @param message - The user message to send.
     * @param externalSignal - Optional abort signal for cancellation tests.
     * @returns The orchestrator result, history, facts, and events.
     */
    async function callOrchestrator(
        serverUrl: string,
        message = "compute 1+1",
        externalSignal?: AbortSignal,
    ): Promise<OrchestratorTestResult> {
        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const events: AiChatEvent[] = [];
        const controller = new AbortController();

        const result = await handleUserMessage({
            message,
            endpointUrl: serverUrl,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
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
            signal: externalSignal ?? controller.signal,
        });

        return { result, history, facts, events };
    }

    /**
     * Runs assertions from a fixture's expected block against the orchestrator result.
     *
     * @param expected - The expected values from the fixture file.
     * @param result - The orchestrator return value.
     */
    function assertExpected(
        expected: FixtureExpected,
        result: OrchestratorTestResult["result"],
    ): void {
        expect(result.text).toBe(expected.text);
        expect(result.steps).toHaveLength(expected.stepCount);
        for (let i = 0; i < expected.steps.length; i++) {
            expect(result.steps[i].result.success).toBe(
                expected.steps[i].success,
            );
            if (expected.steps[i].value !== undefined) {
                expect(result.steps[i].result.value).toBe(
                    expected.steps[i].value,
                );
            }
        }
        if (expected.minRequestCount !== undefined && mockServer) {
            expect(mockServer.requestCount()).toBeGreaterThanOrEqual(
                expected.minRequestCount,
            );
        }
    }

    it("handles simple code execution", async () => {
        const { responses, expected } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("handles multi-round with continue_thinking", async () => {
        const { responses, expected } = loadFixture("multi-round");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("recovers from runtime error", async () => {
        const { responses, expected } = loadFixture("runtime-error-recovery");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("handles print terminal output", async () => {
        const { responses, expected } = loadFixture("print-terminal");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("handles null content response", async () => {
        const { responses, expected } = loadFixture("content-null");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("extracts code from markdown fences", async () => {
        const { responses, expected } = loadFixture("markdown-fenced");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("concatenates multiple fenced blocks", async () => {
        const { responses, expected } = loadFixture("multiple-fenced-blocks");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("retries after HTTP 500 and succeeds on next attempt", async () => {
        const { responses, expected } = loadFixture("http-500-retry");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("rejects with abort error when signal fires before response", async () => {
        // Mock server delays its response long enough for the abort to fire
        const delayedResponse: MockCompletion = {
            choices: [
                {
                    message: { role: "assistant", content: "too late" },
                    finish_reason: "stop",
                },
            ],
            _delayMs: 5000,
        };
        mockServer = await startMockServer([delayedResponse]);

        const controller = new AbortController();
        // Abort after 100ms — well before the 5s delayed response
        setTimeout(() => controller.abort(), 100);

        await expect(
            callOrchestrator(mockServer.url, "hello", controller.signal),
        ).rejects.toThrow();
    });

    it("preserves empty history when cancelled before LLM responds", async () => {
        const delayedResponse: MockCompletion = {
            choices: [
                {
                    message: { role: "assistant", content: "too late" },
                    finish_reason: "stop",
                },
            ],
            _delayMs: 5000,
        };
        mockServer = await startMockServer([delayedResponse]);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const events: AiChatEvent[] = [];
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);

        try {
            await handleUserMessage({
                message: "hello",
                endpointUrl: mockServer.url,
                apiKey: "",
                model: "test-model",
                allowedDir: tmpDir,
                config: minimalConfig,
                /**
                 * Collects events for assertions.
                 *
                 * @param e - The event to collect.
                 */
                emitEvent: (e: AiChatEvent) => {
                    events.push(e);
                },
                history,
                facts,
                signal: controller.signal,
            });
        } catch {
            // Expected — abort causes rejection
        }

        // History should not contain any stale assistant messages
        const assistantMessages = history.filter((m) => m.role === "assistant");
        expect(assistantMessages).toHaveLength(0);
    });

    it("retries when terminal round produces no output", async () => {
        const { responses, expected } = loadFixture("no-output-retry");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result);
    });

    it("emits code_execution events (not tool_execution)", async () => {
        const { responses } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        const { events } = await callOrchestrator(mockServer.url);

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain("code_execution_start");
        expect(eventTypes).toContain("code_execution_end");
        expect(eventTypes).not.toContain("tool_execution_start");
        expect(eventTypes).not.toContain("tool_execution_end");
    });

    it("honors Retry-After header on 429 responses", async () => {
        const responses: MockCompletion[] = [
            {
                choices: [],
                _statusCode: 429,
                _headers: { "Retry-After": "1" },
            },
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

        const start = Date.now();
        const { result } = await callOrchestrator(mockServer.url);
        const elapsed = Date.now() - start;

        expect(result.text).toBe("ok\n");
        // Retry-After: 1 means 1 second delay — should take at least 900ms
        expect(elapsed).toBeGreaterThanOrEqual(900);
        expect(mockServer.requestCount()).toBeGreaterThanOrEqual(2);
    });

    it("includes temperature in request body when set", async () => {
        const { responses } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const events: AiChatEvent[] = [];
        const configWithTemp: AiChatConfig = {
            ...minimalConfig,
            temperature: 0.7,
        };

        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: configWithTemp,
            /**
             * Collects events for assertions.
             *
             * @param e - Event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal: new AbortController().signal,
        });

        const bodies = mockServer.requestBodies();
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies[0].temperature).toBe(0.7);
    });

    it("omits temperature from request body when undefined", async () => {
        const { responses } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        expect(result.text).toBe("2\n");
        const bodies = mockServer.requestBodies();
        expect(bodies.length).toBeGreaterThan(0);
        expect("temperature" in bodies[0]).toBe(false);
    });

    it("stores terminal assistant answer in history for follow-up context", async () => {
        const { responses } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const result = await handleUserMessage({
            message: "compute 1+1",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /** Discards events (unused in this test). */
            emitEvent: () => {},
            history,
            facts,
            signal: new AbortController().signal,
        });

        // The final text shown to the user should appear as an assistant
        // message in history so follow-up turns have context
        const lastAssistant = history
            .filter((m) => m.role === "assistant")
            .pop();
        expect(lastAssistant).toBeDefined();
        expect(lastAssistant?.content).toBe(result.text);
    });

    it("sends max_completion_tokens but not max_tokens in request body", async () => {
        const { responses } = loadFixture("simple-code");
        mockServer = await startMockServer(responses);

        await callOrchestrator(mockServer.url);

        const bodies = mockServer.requestBodies();
        expect(bodies.length).toBeGreaterThan(0);
        expect("max_completion_tokens" in bodies[0]).toBe(true);
        expect("max_tokens" in bodies[0]).toBe(false);
    });

    it("truncates feedback prints exceeding 4096 bytes", async () => {
        // First round: print a huge string + continue_thinking
        // Second round: print the answer
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

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /** Discards events (unused in this test). */
            emitEvent: () => {},
            history,
            facts,
            signal: new AbortController().signal,
        });

        // Find the feedback user message after the first round
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

    it("does not execute code when finish_reason is length", async () => {
        // First response is truncated, second succeeds
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('incomplete",
                        },
                        finish_reason: "length",
                    },
                ],
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

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const events: AiChatEvent[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /**
             * Collects events for assertions.
             *
             * @param e - Event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal: new AbortController().signal,
        });

        expect(result.text).toBe("ok\n");
        // Should have TruncatedResponse error in history
        const truncMsg = history.find(
            (m) => m.role === "user" && m.content.includes("TruncatedResponse"),
        );
        expect(truncMsg).toBeDefined();
        // Truncated round should NOT have code_execution events
        // First event batch: turn_start, llm_request_start/end (no execution)
        // Second event batch: llm_request_start/end, code_execution_start/end
        const codeEvents = events.filter(
            (e) => e.type === "code_execution_start",
        );
        expect(codeEvents).toHaveLength(1);
    });

    it("includes SyntaxError hint in error feedback", async () => {
        // First round: invalid Python, second round: corrected
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

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /** Discards events (unused in this test). */
            emitEvent: () => {},
            history,
            facts,
            signal: new AbortController().signal,
        });

        // Find the SyntaxError feedback in history
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

    it("truncates large expression value in feedback", async () => {
        // First round: builds a large dict and ends with it as expression + continue_thinking
        // The expression value should be truncated in the feedback message
        const bigValue = "x".repeat(5000);
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: `result = "${bigValue}"\ncontinue_thinking()\nresult`,
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

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /** Discards events (unused in this test). */
            emitEvent: () => {},
            history,
            facts,
            signal: new AbortController().signal,
        });

        // Find the feedback user message after the first round
        const feedbackMsg = history.find(
            (m) =>
                m.role === "user" &&
                "isExecutionResult" in m &&
                m.isExecutionResult &&
                m.content.includes("value"),
        );
        expect(feedbackMsg).toBeDefined();
        const parsed = JSON.parse(
            feedbackMsg?.content.replace("Code execution result: ", "") ?? "",
        ) as Record<string, unknown>;
        expect(parsed.value_truncated).toBe(true);
        // Total feedback size should be bounded
        const feedbackBytes = Buffer.byteLength(
            feedbackMsg?.content ?? "",
            "utf-8",
        );
        expect(feedbackBytes).toBeLessThanOrEqual(4096 + 200);
    });

    it("writes terminal output to file when exceeding 10KB", async () => {
        // Generate code that prints > 10KB of output
        const bigOutput = "A".repeat(11000);
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: `print("${bigOutput}")`,
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        // Should return overflow pointer message
        expect(result.text).toContain("Output too large");
        expect(result.text).toContain("bytes");
        expect(result.text).toContain("ai_chat_output/");

        // Verify the file was actually written
        const outputDir = join(tmpDir, "ai_chat_output");
        const files = await readdir(outputDir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/\.txt$/);
        const fileContent = await readFile(join(outputDir, files[0]), "utf-8");
        expect(fileContent).toContain(bigOutput);
    });

    it("rejects overflow write when ai_chat_output is a symlink outside allowed dir", async () => {
        // Plant a symlink at ai_chat_output pointing outside tmpDir
        const outsideDir = await mkdtemp(join(tmpdir(), "overflow-escape-"));
        await symlink(outsideDir, join(tmpDir, "ai_chat_output"));

        // Code that produces >10KB of output to trigger overflow
        const bigOutput = "B".repeat(11000);
        const responses: MockCompletion[] = [
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: `print("${bigOutput}")`,
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        // Should not write to symlink target — should fail safely
        const outsideFiles = await readdir(outsideDir);
        expect(outsideFiles).toHaveLength(0);
        // The orchestrator should still return something (not crash)
        expect(result.text).toBeDefined();

        await rm(outsideDir, { recursive: true });
    });

    it("truncates feedback prints without splitting multi-byte UTF-8 characters", async () => {
        // Euro sign '€' is 3 bytes in UTF-8; 2000 chars = 6000 bytes, exceeds 4096 limit.
        // 4096 / 3 = 1365.33 — the cut falls mid-character, producing \uFFFD without the fix.
        const bigPrint = "\u20AC".repeat(2000);
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

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: minimalConfig,
            /** Discards events (unused in this test). */
            emitEvent: () => {},
            history,
            facts,
            signal: new AbortController().signal,
        });

        // Find the truncated feedback message
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
        // The prints field should not contain the Unicode replacement character
        // which appears when a multi-byte sequence is split
        expect(String(parsed.prints)).not.toContain("\uFFFD");
    });

    it("skips execution for truncated forced-final response", async () => {
        // Exhaust maxRounds with continue_thinking, then forced-final has finish_reason=length.
        // Truncated code must NOT be executed — falls through to the fallback message.
        const configWith2Rounds: AiChatConfig = {
            ...minimalConfig,
            maxCodeRounds: 1,
        };
        const responses: MockCompletion[] = [
            // Round 1: continue_thinking (exhausts the single round)
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
            // Forced-final round: truncated response
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('partial",
                        },
                        finish_reason: "length",
                    },
                ],
            },
        ];
        mockServer = await startMockServer(responses);

        const history: HistoryEntry[] = [];
        const facts: Fact[] = [];
        const events: AiChatEvent[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: configWith2Rounds,
            /**
             * Collects events for assertions.
             *
             * @param e - Event to collect.
             */
            emitEvent: (e: AiChatEvent) => {
                events.push(e);
            },
            history,
            facts,
            signal: new AbortController().signal,
        });

        // Truncated code is not executed — the fallback message mentions truncation
        expect(result.text).toContain("truncated");
        // No code_execution_start events should fire for the forced-final round
        // (only for the main-loop round that exhausted maxRounds)
        const codeStartEvents = events.filter(
            (e) => e.type === "code_execution_start",
        );
        // Only round 1 (the continue_thinking round) should have a code_execution_start
        expect(codeStartEvents.length).toBe(1);
    });
});
