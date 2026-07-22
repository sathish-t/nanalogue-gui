// End-to-end tests for handleUserMessage removedTools behavior.

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
import type { Fact, HistoryEntry } from "./chat-types";

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
    const cfg = createAiChatConfig({ maxCodeRounds: 3 });

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
