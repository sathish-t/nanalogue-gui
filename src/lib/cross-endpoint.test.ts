// Cross-endpoint compatibility tests for the chat orchestrator.
// Verifies handleUserMessage works with different LLM response shapes and error recovery.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
            /** The text content (null when tool calls present). */
            content?: string | null;
            /** Optional tool calls. */
            tool_calls?: Array<{
                /** Unique identifier for this tool call. */
                id: string;
                /** The type of tool call (always "function"). */
                type: string;
                /** The function name and arguments. */
                function: {
                    /** The function name. */
                    name: string;
                    /** Arguments: string for OpenAI, object for Ollama. */
                    arguments: string | Record<string, unknown>;
                };
            }>;
        };
        /** The reason generation stopped. */
        finish_reason: string;
    }>;
}

/** An OpenAI-compatible message in the request body. */
interface RequestMessage {
    /** The message role. */
    role: string;
    /** The text content. */
    content?: string;
    /** The tool call ID (for tool results). */
    tool_call_id?: string;
}

/** Parsed request body from the SDK. */
interface RequestBody {
    /** The messages sent by the SDK. */
    messages: RequestMessage[];
}

/**
 * A response entry: either a static completion or a function that builds one
 * from the parsed request body (so the mock LLM can echo real sandbox results).
 */
type ResponseEntry = MockCompletion | ((body: RequestBody) => MockCompletion);

/** Return type of startMockServer. */
interface MockServer {
    /** The base URL (e.g., http://127.0.0.1:PORT/v1). */
    url: string;
    /** Closes the mock server. */
    close: () => Promise<void>;
    /** Returns the number of requests handled so far. */
    requestCount: () => number;
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
    /** Expected number of tool messages in history (omitted for retry tests). */
    toolMessageCount?: number;
    /** Minimum number of requests the server should have received. */
    minRequestCount?: number;
}

/** Shape of a fixture JSON file. */
interface FixtureFile {
    /** Mock responses to queue; null entries become echoResultsResponse. */
    mockResponses: Array<MockCompletion | null>;
    /** Expected test results. */
    expected: FixtureExpected;
}

/** Parsed fixture data ready for use in a test. */
interface LoadedFixture {
    /** The response entries to queue on the mock server. */
    responses: ResponseEntry[];
    /** The expected test results. */
    expected: FixtureExpected;
}

/**
 * Loads a fixture JSON file and converts null entries to echoResultsResponse.
 *
 * @param name - The fixture file name (without extension).
 * @returns The parsed responses array and expected results.
 */
function loadFixture(name: string): LoadedFixture {
    const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8");
    const fixture = JSON.parse(raw) as FixtureFile;
    const responses: ResponseEntry[] = fixture.mockResponses.map((entry) =>
        entry === null ? echoResultsResponse : entry,
    );
    return { responses, expected: fixture.expected };
}

/**
 * Starts a local HTTP server that returns queued OpenAI-compatible responses.
 * Entries can be static MockCompletion objects or functions that receive the
 * parsed request body and return a MockCompletion dynamically.
 *
 * @param responses - Queue of response entries to return in sequence.
 * @returns The mock server URL, close function, and request counter.
 */
async function startMockServer(
    responses: ResponseEntry[],
): Promise<MockServer> {
    let idx = 0;

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
                const body = JSON.parse(
                    Buffer.concat(chunks).toString(),
                ) as RequestBody;
                const entry =
                    idx < responses.length
                        ? responses[idx]
                        : responses[responses.length - 1];
                idx++;
                const completion =
                    typeof entry === "function" ? entry(body) : entry;
                res.writeHead(200, {
                    "Content-Type": "application/json",
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
    };
}

/**
 * Extracts successful tool result content strings from the SDK request body.
 * Skips error messages (from invalid tool calls) so the echoed text only
 * contains real sandbox computation results.
 *
 * @param body - The parsed request body.
 * @returns An array of successful tool result content strings.
 */
function toolResultsFrom(body: RequestBody): string[] {
    return body.messages
        .filter(
            (m) =>
                m.role === "tool" &&
                m.content !== undefined &&
                !m.content.startsWith("Invalid input for tool"),
        )
        .map((m) => m.content as string);
}

/**
 * Builds a dynamic final text response that echoes real sandbox results.
 * The mock LLM summarizes successful tool results it received from the SDK,
 * proving the real sandbox computation flowed through the full loop.
 *
 * @param body - The parsed request body containing tool results.
 * @returns A MockCompletion with text derived from actual sandbox output.
 */
function echoResultsResponse(body: RequestBody): MockCompletion {
    const results = toolResultsFrom(body);
    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content: `sandbox returned: ${results.join(", ")}`,
                },
                finish_reason: "stop",
            },
        ],
    };
}

/** Minimal AI chat config for cross-endpoint tests. */
const minimalConfig: AiChatConfig = {
    contextWindowTokens: 4096,
    maxRetries: 2,
    timeoutSeconds: 30,
    maxRecordsReadInfo: 100,
    maxRecordsBamMods: 100,
    maxRecordsWindowReads: 100,
    maxRecordsSeqTable: 100,
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
     * @returns The orchestrator result, history, facts, and events.
     */
    async function callOrchestrator(
        serverUrl: string,
        message = "compute 1+1",
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
            signal: controller.signal,
            dedupCache: new Map(),
        });

        return { result, history, facts, events };
    }

    /**
     * Runs assertions from a fixture's expected block against the orchestrator result.
     *
     * @param expected - The expected values from the fixture file.
     * @param result - The orchestrator return value.
     * @param history - The conversation history after the call.
     */
    function assertExpected(
        expected: FixtureExpected,
        result: OrchestratorTestResult["result"],
        history: HistoryEntry[],
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
        if (expected.toolMessageCount !== undefined) {
            const toolMessages = history.filter((m) => m.role === "tool");
            expect(toolMessages).toHaveLength(expected.toolMessageCount);
        }
        if (expected.minRequestCount !== undefined && mockServer) {
            expect(mockServer.requestCount()).toBeGreaterThanOrEqual(
                expected.minRequestCount,
            );
        }
    }

    it("handles OpenAI response shape with string arguments", async () => {
        const { responses, expected } = loadFixture("openai-string-args");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("handles Ollama response shape with stop finish_reason", async () => {
        const { responses, expected } = loadFixture("ollama-stop-finish");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("handles multiple tool calls in one response", async () => {
        const { responses, expected } = loadFixture("multiple-tool-calls");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("pairs each step with its tool call ID", async () => {
        const { responses } = loadFixture("multiple-tool-calls");
        mockServer = await startMockServer(responses);

        const { result } = await callOrchestrator(mockServer.url);

        expect(result.steps).toHaveLength(2);
        expect(result.steps[0].toolCallId).toBe("call_1");
        expect(result.steps[1].toolCallId).toBe("call_2");
    });

    it("recovers from malformed JSON in arguments via LLM retry", async () => {
        const { responses, expected } = loadFixture("malformed-json-retry");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("handles mixed success and failure in parallel tool calls", async () => {
        const { responses, expected } = loadFixture("mixed-success-failure");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("handles mixed success and runtime error in parallel tool calls", async () => {
        const { responses, expected } = loadFixture(
            "mixed-success-runtime-error",
        );
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });

    it("recovers from missing code field via LLM retry", async () => {
        const { responses, expected } = loadFixture("missing-code-retry");
        mockServer = await startMockServer(responses);

        const { result, history } = await callOrchestrator(mockServer.url);

        assertExpected(expected, result, history);
    });
});
