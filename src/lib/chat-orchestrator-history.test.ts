// Unit tests for chat orchestrator history budgets and context windowing.

import { describe, expect, it } from "vitest";
import {
    applySlidingWindow,
    deriveHistoryBudgetTokens,
    transformContext,
} from "./chat-orchestrator";
import type { HistoryEntry } from "./chat-types";

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
    it("preserves failed rounds while they fit within the context budget", () => {
        const history: HistoryEntry[] = [
            { role: "user", content: "test" },
            { role: "assistant", content: "bad_code_old" },
            {
                role: "user",
                content: "error_old",
                isExecutionResult: true,
            },
            { role: "assistant", content: "bad_code_recent" },
            {
                role: "user",
                content: "error_recent",
                isExecutionResult: true,
            },
            { role: "assistant", content: "Done" },
        ];
        const result = transformContext(history, {
            contextBudgetTokens: 10000,
        });
        expect(result).toEqual(history);
    });

    it("still drops the oldest messages when the context budget is exceeded", () => {
        const history: HistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
            role: "user" as const,
            content: `Message ${i} ${"x".repeat(200)}`,
        }));
        const result = transformContext(history, {
            contextBudgetTokens: 100,
        });
        expect(result.length).toBeLessThan(history.length);
        expect(result[result.length - 1]).toEqual(history[history.length - 1]);
    });
});
