// End-to-end tests for handleUserMessage main-loop recovery behavior.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleUserMessage, resetLastSentMessages } from "./chat-orchestrator";
import { createAiChatConfig } from "./chat-orchestrator-handle-message-test-utils";
import {
    type MockServer,
    startMockServer,
} from "./chat-orchestrator-test-utils";
import type { AiChatEvent, Fact, HistoryEntry } from "./chat-types";

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
        const facts: Fact[] = [];
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
            facts,
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
});
