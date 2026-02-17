// Unit tests for chat orchestrator functions.
// Tests pruneFailedToolCalls, facts extraction, and context pipeline.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    addFact,
    applySlidingWindow,
    dedupKey,
    evictFacts,
    extractFacts,
    pruneFailedToolCalls,
    renderFactsBlock,
    runSandboxGuarded,
    transformContext,
} from "./chat-orchestrator";
import type { Fact, HistoryEntry } from "./chat-types";

describe("pruneFailedToolCalls", () => {
    it("drops failed tool round-trips", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "How many reads?" },
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "c1",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"bad"}',
                        },
                    },
                ],
            },
            {
                role: "tool",
                tool_call_id: "c1",
                content: "RuntimeError: ...",
                success: false,
            },
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "c2",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"good"}',
                        },
                    },
                ],
            },
            {
                role: "tool",
                tool_call_id: "c2",
                content: "42",
                success: true,
            },
            { role: "assistant", content: "There are 42 reads." },
        ];
        const pruned = pruneFailedToolCalls(history);
        expect(pruned).toHaveLength(4);
        // Both the failed tool result and its corresponding assistant tool_call are removed
        expect(
            pruned.some((m) => m.role === "tool" && m.tool_call_id === "c1"),
        ).toBe(false);
        expect(
            pruned.some(
                (m) =>
                    m.role === "assistant" &&
                    m.tool_calls?.some((tc) => tc.id === "c1"),
            ),
        ).toBe(false);
    });

    it("preserves all-successful turns unchanged", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Count reads" },
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "c1",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"ok"}',
                        },
                    },
                ],
            },
            {
                role: "tool",
                tool_call_id: "c1",
                content: "100",
                success: true,
            },
            { role: "assistant", content: "100 reads." },
        ];
        const pruned = pruneFailedToolCalls(history);
        expect(pruned).toHaveLength(4);
    });

    it("strips failed calls from multi-call assistant messages", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Analyze the BAM" },
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "c1",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"bad"}',
                        },
                    },
                    {
                        id: "c2",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"good"}',
                        },
                    },
                ],
            },
            {
                role: "tool",
                tool_call_id: "c1",
                content: "RuntimeError: ...",
                success: false,
            },
            {
                role: "tool",
                tool_call_id: "c2",
                content: "42",
                success: true,
            },
            { role: "assistant", content: "Got 42 reads." },
        ];
        const pruned = pruneFailedToolCalls(history);
        // Failed tool result removed
        expect(
            pruned.some((m) => m.role === "tool" && m.tool_call_id === "c1"),
        ).toBe(false);
        // Successful tool result kept
        expect(
            pruned.some((m) => m.role === "tool" && m.tool_call_id === "c2"),
        ).toBe(true);
        // Assistant message kept but failed call stripped from tool_calls
        const assistantWithCalls = pruned.find(
            (m) => m.role === "assistant" && m.tool_calls,
        );
        expect(assistantWithCalls).toBeDefined();
        expect(assistantWithCalls?.tool_calls).toHaveLength(1);
        expect(assistantWithCalls?.tool_calls?.[0].id).toBe("c2");
    });

    it("handles turns with no tool calls", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there!" },
        ];
        const pruned = pruneFailedToolCalls(history);
        expect(pruned).toHaveLength(2);
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
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "c1",
                        type: "function",
                        function: {
                            name: "execute_sandbox_code",
                            arguments: '{"code":"bad"}',
                        },
                    },
                ],
            },
            {
                role: "tool",
                tool_call_id: "c1",
                content: "error",
                success: false,
            },
            { role: "assistant", content: "Done" },
        ];
        const result = transformContext(history, {
            contextBudgetTokens: 10000,
        });
        // Failed tool call should be pruned
        expect(
            result.some((m) => m.role === "tool" && m.tool_call_id === "c1"),
        ).toBe(false);
    });
});

describe("dedupKey", () => {
    it("produces consistent keys for same input", () => {
        const k1 = dedupKey("call_1", { code: "x = 1" });
        const k2 = dedupKey("call_1", { code: "x = 1" });
        expect(k1).toBe(k2);
    });

    it("produces different keys for different args", () => {
        const k1 = dedupKey("call_1", { code: "x = 1" });
        const k2 = dedupKey("call_1", { code: "x = 2" });
        expect(k1).not.toBe(k2);
    });
});

describe("addFact", () => {
    it("adds a new fact", () => {
        const facts: Fact[] = [];
        addFact(facts, {
            type: "file",
            filename: "test.bam",
            toolCallId: "c1",
            timestamp: 1000,
        });
        expect(facts).toHaveLength(1);
    });

    it("replaces fact with same key", () => {
        const facts: Fact[] = [
            {
                type: "result",
                filename: "test.bam",
                metric: "reads",
                value: "100",
                filters: "",
                toolCallId: "c1",
                timestamp: 1000,
                fromTruncated: false,
            },
        ];
        addFact(facts, {
            type: "result",
            filename: "test.bam",
            metric: "reads",
            value: "200",
            filters: "",
            toolCallId: "c2",
            timestamp: 2000,
            fromTruncated: false,
        });
        expect(facts).toHaveLength(1);
        expect(
            (
                facts[0] as {
                    /** The fact's metric value. */
                    value: string;
                }
            ).value,
        ).toBe("200");
    });
});

describe("evictFacts", () => {
    it("does not evict when under limit", () => {
        const facts: Fact[] = [
            {
                type: "file",
                filename: "test.bam",
                toolCallId: "c1",
                timestamp: 1000,
            },
        ];
        evictFacts(facts);
        expect(facts).toHaveLength(1);
    });

    it("evicts oldest result/filter facts when over limit", () => {
        const facts: Fact[] = [];
        // Add many result facts to exceed 2KB
        for (let i = 0; i < 50; i++) {
            facts.push({
                type: "result",
                filename: `file_${i}.bam`,
                metric: `metric_${i}`,
                value: `value_${i}_${"x".repeat(50)}`,
                filters: `filter_${i}`,
                toolCallId: `c${i}`,
                timestamp: i,
                fromTruncated: false,
            });
        }
        evictFacts(facts);
        expect(facts.length).toBeLessThan(50);
    });

    it("preserves output facts during eviction", () => {
        const facts: Fact[] = [
            {
                type: "output",
                path: "ai_chat_output/results.bed",
                toolCallId: "c0",
                timestamp: 0,
            },
        ];
        // Add many result facts
        for (let i = 0; i < 50; i++) {
            facts.push({
                type: "result",
                filename: `file_${i}.bam`,
                metric: `metric_${i}`,
                value: `value_${i}_${"x".repeat(50)}`,
                filters: "",
                toolCallId: `c${i + 1}`,
                timestamp: i + 1,
                fromTruncated: false,
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
                toolCallId: "c1",
                timestamp: 1000,
            },
        ];
        const block = renderFactsBlock(facts);
        expect(block).toContain("Conversation facts");
        expect(block).toContain("test.bam");
        expect(block).toContain("```json");
        // Should not include internal fields
        expect(block).not.toContain("toolCallId");
        expect(block).not.toContain("timestamp");
    });
});

describe("extractFacts", () => {
    it("extracts file facts from successful result", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: true, value: 42 },
            { code: 'x = read_info("test.bam")' },
            "call_1",
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
            "call_1",
            facts,
        );
        expect(facts).toHaveLength(0);
    });

    it("extracts filter facts from kwargs in successful result", () => {
        const facts: Fact[] = [];
        extractFacts(
            { success: true, value: "ok" },
            { code: 'window_reads("f.bam", region="chr1:1-100")' },
            "call_1",
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
            "call_1",
            facts,
        );
        expect(facts).toHaveLength(0);
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

    // The abort-while-waiting path (AbortError when signal fires while
    // polling for the lock) cannot be tested here because runSandboxCode
    // uses a blocking native addon that prevents the event loop from
    // processing setTimeout callbacks during execution. The while-loop
    // abort mechanism would activate in a truly async implementation.

    it("ignores abort signal when lock is free", async () => {
        // When the lock is not held, runSandboxGuarded skips the while
        // loop and runs the sandbox regardless of the abort signal.
        const controller = new AbortController();
        controller.abort();
        const result = await runSandboxGuarded(
            "1 + 1",
            tmpDir,
            {},
            controller.signal,
        );
        expect(result.success).toBe(true);
        expect(result.value).toBe(2);
    });
});
