// End-to-end tests for handleUserMessage main-loop recovery behavior.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_BLANK_RETRIES } from "./ai-chat-constants";
import { handleUserMessage, resetLastSentMessages } from "./chat-orchestrator";
import { createAiChatConfig } from "./chat-orchestrator-handle-message-test-utils";
import {
    type MockServer,
    startMockServer,
} from "./chat-orchestrator-test-utils";
import type { AiChatEvent, HistoryEntry } from "./chat-types";

describe("main-loop recovery paths", () => {
    let tmpDir: string;
    let mockServer: MockServer | undefined;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "loop-recovery-test-"));
        resetLastSentMessages();
    });

    afterEach(async () => {
        if (mockServer) {
            await mockServer.close();
            mockServer = undefined;
        }
        await rm(tmpDir, { recursive: true, force: true });
    });

    /** Minimal config for main-loop recovery tests. */
    const cfg = createAiChatConfig({ maxCodeRounds: 3 });

    it("retries after a main-loop length-truncated response", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('partial')",
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
                            content: "print('final answer')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const events: AiChatEvent[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /**
             * Collects emitted events.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            signal: new AbortController().signal,
        });

        expect(result.text).toContain("final answer");
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].code).toBe("print('final answer')");
        expect(
            history.some(
                (entry) =>
                    entry.role === "assistant" &&
                    entry.content === "print('partial')",
            ),
        ).toBe(true);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("TruncatedResponse"),
            ),
        ).toBe(true);
        expect(
            events.filter((event) => event.type === "code_execution_start"),
        ).toHaveLength(1);
    });

    it("retries when a length-truncated response has no visible content", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: null },
                        finish_reason: "length",
                    },
                ],
            },
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
        ]);

        const history: HistoryEntry[] = [];
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
            signal: new AbortController().signal,
        });

        expect(result.text).toContain("final answer");
        expect(mockServer.requestCount()).toBe(2);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("TruncatedResponse"),
            ),
        ).toBe(true);
    });

    it("retries blank responses and records their finish reasons", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: "   " },
                        finish_reason: "stop",
                    },
                ],
            },
            {
                choices: [
                    {
                        message: { role: "assistant", content: null },
                        finish_reason: "content_filter",
                    },
                ],
            },
            { choices: [] },
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
        ]);

        const history: HistoryEntry[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: createAiChatConfig({
                maxCodeRounds: DEFAULT_MAX_BLANK_RETRIES + 2,
            }),
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            signal: new AbortController().signal,
        });

        const blankFeedback = history
            .filter(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("BlankAssistantResponse"),
            )
            .map(
                (entry) =>
                    JSON.parse(
                        entry.content.replace("Code execution result: ", ""),
                    ) as Record<string, unknown>,
            );
        expect(result.text).toBe("final answer\n");
        expect(result.steps).toHaveLength(1);
        expect(mockServer.requestCount()).toBe(4);
        expect(blankFeedback).toHaveLength(DEFAULT_MAX_BLANK_RETRIES);
        expect(blankFeedback.map((feedback) => feedback.finish_reason)).toEqual(
            ["stop", "content_filter", null],
        );
        expect(
            blankFeedback.map((feedback) => feedback.blank_retries_remaining),
        ).toEqual([3, 2, 1]);
    });

    it("stops after three retries when responses remain blank", async () => {
        const blankCompletion = {
            choices: [
                {
                    message: { role: "assistant", content: null },
                    finish_reason: "stop",
                },
            ],
        };
        mockServer = await startMockServer([
            blankCompletion,
            blankCompletion,
            blankCompletion,
            blankCompletion,
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "print('must not be requested')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: createAiChatConfig({
                maxCodeRounds: DEFAULT_MAX_BLANK_RETRIES + 2,
            }),
            /** No-op event handler for test isolation. */
            emitEvent: () => {
                /* no-op */
            },
            history,
            signal: new AbortController().signal,
        });

        const blankFeedback = history.filter(
            (entry) =>
                entry.role === "user" &&
                entry.content.includes("BlankAssistantResponse"),
        );
        expect(result.text).toContain("did not produce a usable response");
        expect(result.steps).toHaveLength(0);
        expect(mockServer.requestCount()).toBe(DEFAULT_MAX_BLANK_RETRIES + 1);
        expect(blankFeedback).toHaveLength(DEFAULT_MAX_BLANK_RETRIES + 1);
        expect(blankFeedback.at(-1)?.content).toContain(
            '"blank_retries_remaining":0',
        );
    });

    it("retries a provider-filtered malformed function call as source text", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: { role: "assistant", content: null },
                        finish_reason:
                            "function_call_filter: MALFORMED_FUNCTION_CALL",
                    },
                ],
            },
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
        ]);

        const history: HistoryEntry[] = [];
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
            signal: new AbortController().signal,
        });

        expect(result.text).toContain("final answer");
        expect(mockServer.requestCount()).toBe(2);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("MalformedFunctionCall") &&
                    entry.content.includes("raw Python source text"),
            ),
        ).toBe(true);
    });

    it("repairs reasoning markup before starting Monty execution", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content:
                                "```python\nfiles = ls()\nfiles\n</think>\n```",
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
                            content: "print('repaired response')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const events: AiChatEvent[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /**
             * Collects progress events to prove reasoning markup never reaches Monty.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            signal: new AbortController().signal,
        });

        expect(result.text).toBe("repaired response\n");
        expect(result.steps).toHaveLength(1);
        expect(
            events.filter((event) => event.type === "code_execution_start"),
        ).toHaveLength(1);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes('"protocol":"reasoning_markup"') &&
                    entry.content.includes("<think>"),
            ),
        ).toBe(true);
    });

    it("repairs native tool markup before starting Monty execution", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content:
                                "```python\n<tool_calls>\n" +
                                '<invoke name="ls">\n' +
                                '<parameter name="pattern">**/*.bam</parameter>\n' +
                                "</invoke>\n</tool_calls>\n```",
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
                            content: "print('repaired response')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
        const events: AiChatEvent[] = [];
        const result = await handleUserMessage({
            message: "test",
            endpointUrl: mockServer.url,
            apiKey: "",
            model: "test-model",
            allowedDir: tmpDir,
            config: cfg,
            /**
             * Collects progress events to prove malformed text never reaches Monty.
             *
             * @param event - The event to collect.
             */
            emitEvent: (event: AiChatEvent) => {
                events.push(event);
            },
            history,
            signal: new AbortController().signal,
        });

        expect(result.text).toBe("repaired response\n");
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0].code).toBe("print('repaired response')");
        expect(
            events.filter((event) => event.type === "code_execution_start"),
        ).toHaveLength(1);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("MalformedAssistantProtocol") &&
                    entry.content.includes('files = ls(\\"**/*.bam\\")'),
            ),
        ).toBe(true);
    });

    it("retries when successful code produces no terminal output", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "x = 1",
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
                            content: "print('final answer')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
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
            signal: new AbortController().signal,
        });

        expect(result.text).toContain("final answer");
        expect(result.steps).toHaveLength(2);
        expect(result.steps[0].result.success).toBe(true);
        expect(result.steps[1].result.success).toBe(true);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes("Your code produced no output"),
            ),
        ).toBe(true);
    });

    it("automatically continues a tool-using round without continue_thinking", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: 'files = ls()\nprint("inspected files")',
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
                            content: "print('final answer')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

        const history: HistoryEntry[] = [];
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
            signal: new AbortController().signal,
        });

        expect(result.text).toBe("final answer\n");
        expect(result.steps).toHaveLength(2);
        expect(mockServer.requestCount()).toBe(2);
        expect(result.steps[0].result.sandboxToolCalled).toBe(true);
        expect(
            history.some(
                (entry) =>
                    entry.role === "user" &&
                    entry.content.includes('"automatic_continuation":true'),
            ),
        ).toBe(true);
    });

    it("automatically continues a bare-expression round without continue_thinking", async () => {
        mockServer = await startMockServer([
            {
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: "1 + 1",
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
                            content: "print('The answer is 2')",
                        },
                        finish_reason: "stop",
                    },
                ],
            },
        ]);

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
            history: [],
            signal: new AbortController().signal,
        });

        expect(result.text).toBe("The answer is 2\n");
        expect(result.steps).toHaveLength(2);
        expect(mockServer.requestCount()).toBe(2);
    });
});
