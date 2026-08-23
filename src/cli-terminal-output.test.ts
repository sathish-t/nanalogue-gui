// Tests for nanalogue-chat terminal formatting and progress output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TERMINAL_BOLD,
    TERMINAL_CLEAR_LINE,
    TERMINAL_DIM,
    TERMINAL_LIGHT_BLUE,
    TERMINAL_RED,
    TERMINAL_RESET,
    TERMINAL_YELLOW,
} from "./cli-terminal-formatting";
import { color, emitEvent, printUsage } from "./cli-terminal-output";
import { EXTERNAL_FUNCTIONS } from "./lib/ai-chat-constants";
import { CONFIG_FIELD_SPECS } from "./lib/ai-chat-shared-constants";
import type { SandboxResult } from "./lib/chat-types";

/** Whether NO_COLOR existed before the current test. */
const HAD_NO_COLOR = "NO_COLOR" in process.env;
/** Original NO_COLOR value restored after each test. */
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

beforeEach(() => {
    delete process.env.NO_COLOR;
});

afterEach(() => {
    vi.restoreAllMocks();
    if (HAD_NO_COLOR) {
        process.env.NO_COLOR = ORIGINAL_NO_COLOR;
    } else {
        delete process.env.NO_COLOR;
    }
});

describe("CLI terminal formatting", () => {
    it.each([
        ["reset", TERMINAL_RESET, "\x1b[0m"],
        ["bold", TERMINAL_BOLD, "\x1b[1m"],
        ["dim", TERMINAL_DIM, "\x1b[2m"],
        ["red", TERMINAL_RED, "\x1b[31m"],
        ["yellow", TERMINAL_YELLOW, "\x1b[33m"],
        ["light blue", TERMINAL_LIGHT_BLUE, "\x1b[94m"],
        ["clear line", TERMINAL_CLEAR_LINE, "\r\x1b[K"],
    ])("defines the exact %s terminal sequence", (_name, actual, expected) => {
        expect(actual).toBe(expected);
    });

    it("wraps text in a trimmed ANSI style and reset sequence", () => {
        expect(color(` ${TERMINAL_RED} `, "failure")).toBe(
            `${TERMINAL_RED}failure${TERMINAL_RESET}`,
        );
    });

    it("returns plain text when NO_COLOR is present", () => {
        process.env.NO_COLOR = "1";
        expect(color(TERMINAL_YELLOW, "thinking")).toBe("thinking");
    });

    it("returns empty text without adding formatting", () => {
        expect(color(TERMINAL_BOLD, "")).toBe("");
    });

    it("rejects missing and pathologically long ANSI styles", () => {
        expect(() => color(" ", "text")).toThrow("Invalid ANSI color code");
        expect(() => color("1234567890", "text")).toThrow(
            "Invalid ANSI color code",
        );
    });

    it("prints the complete CLI usage text with shared formatting", () => {
        const log = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);

        printUsage();

        expect(log).toHaveBeenCalledOnce();
        const usage = String(log.mock.calls[0]?.[0]);
        expect(usage).toContain(
            `${TERMINAL_BOLD}nanalogue-chat${TERMINAL_RESET}`,
        );
        expect(usage).toContain("--endpoint <url>");
        expect(usage).toContain("--max-duration-secs <n>");
        expect(usage).toContain("/dump_system_prompt");
    });

    it("rejects an external function list with only eleven items", () => {
        const log = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const mutableFunctions = EXTERNAL_FUNCTIONS as unknown as string[];
        const removedFunctions = mutableFunctions.splice(11);

        try {
            expect(() => printUsage()).toThrow(
                "CLI usage external function list must contain more than 11 items!",
            );
            expect(log).not.toHaveBeenCalled();
        } finally {
            mutableFunctions.push(...removedFunctions);
        }
    });

    it("rejects empty external function names before printing", () => {
        const log = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const mutableFunctions = EXTERNAL_FUNCTIONS as unknown as string[];
        const originalFunction = mutableFunctions[0] as string;
        mutableFunctions[0] = " ";

        try {
            expect(() => printUsage()).toThrow(
                "CLI usage external function at index 0 is empty!",
            );
            expect(log).not.toHaveBeenCalled();
        } finally {
            mutableFunctions[0] = originalFunction;
        }
    });

    it.each([
        [0, "CLI usage external function items 0-3 exceed 40 characters!"],
        [4, "CLI usage external function items 4-7 exceed 40 characters!"],
        [8, "CLI usage external function items 8-10 exceed 40 characters!"],
        [
            11,
            "CLI usage external function items from index 11 exceed 40 characters!",
        ],
    ])("rejects an oversized external function group starting at index %i", (functionIndex, expectedError) => {
        const log = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const mutableFunctions = EXTERNAL_FUNCTIONS as unknown as string[];
        const originalFunction = mutableFunctions[functionIndex] as string;
        mutableFunctions[functionIndex] = "x".repeat(41);

        try {
            expect(() => printUsage()).toThrow(expectedError);
            expect(log).not.toHaveBeenCalled();
        } finally {
            mutableFunctions[functionIndex] = originalFunction;
        }
    });

    it("rejects non-integer usage fallbacks before printing", () => {
        const log = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);
        const originalFallback = CONFIG_FIELD_SPECS.maxRetries.fallback;
        CONFIG_FIELD_SPECS.maxRetries.fallback = Number.NaN;

        try {
            expect(() => printUsage()).toThrow(
                "CLI usage fallback for maxRetries is not a safe integer!",
            );
            expect(log).not.toHaveBeenCalled();
        } finally {
            CONFIG_FIELD_SPECS.maxRetries.fallback = originalFallback;
        }
    });
});

describe("CLI progress event output", () => {
    /**
     * Installs stdout and console spies used by event-output tests.
     *
     * @returns Spies for stdout writes and console output.
     */
    function spyOnTerminalOutput(): {
        /** Captures writes without printing test progress to stdout. */
        write: ReturnType<typeof vi.spyOn>;
        /** Captures ordinary terminal lines. */
        log: ReturnType<typeof vi.spyOn>;
        /** Captures terminal error lines. */
        error: ReturnType<typeof vi.spyOn>;
    } {
        return {
            write: vi
                .spyOn(process.stdout, "write")
                .mockImplementation(() => true),
            log: vi.spyOn(console, "log").mockImplementation(() => undefined),
            error: vi
                .spyOn(console, "error")
                .mockImplementation(() => undefined),
        };
    }

    it("prints thinking and code-execution progress", () => {
        const { write, log } = spyOnTerminalOutput();

        emitEvent({ type: "turn_start" });
        emitEvent({ type: "code_execution_start", code: "print(42)" });

        expect(write).toHaveBeenNthCalledWith(
            1,
            color(TERMINAL_YELLOW, "[thinking...]"),
        );
        expect(write).toHaveBeenNthCalledWith(2, TERMINAL_CLEAR_LINE);
        expect(log).toHaveBeenCalledWith(
            color(TERMINAL_LIGHT_BLUE, "```python\nprint(42)\n```"),
        );
        expect(write).toHaveBeenNthCalledWith(
            3,
            color(TERMINAL_YELLOW, "[running code...]"),
        );
    });

    it("prints successful sandbox output and truncation status", () => {
        const { write, log } = spyOnTerminalOutput();
        const result: SandboxResult = {
            success: true,
            prints: ["answer="],
            value: { bases: 42 },
            truncated: true,
            endedWithExpression: true,
            continueThinkingCalled: false,
            sandboxToolCalled: false,
        };

        emitEvent({ type: "code_execution_end", result });

        expect(write).toHaveBeenCalledWith(TERMINAL_CLEAR_LINE);
        expect(log).toHaveBeenCalledWith(
            color(TERMINAL_DIM, 'answer={\n  "bases": 42\n} [truncated]'),
        );
    });

    it("prints no-output and string-expression sandbox results", () => {
        const { log } = spyOnTerminalOutput();
        const baseResult = {
            success: true as const,
            truncated: false,
            continueThinkingCalled: false,
            sandboxToolCalled: false,
        };

        emitEvent({
            type: "code_execution_end",
            result: {
                ...baseResult,
                value: undefined,
                endedWithExpression: false,
            },
        });
        emitEvent({
            type: "code_execution_end",
            result: {
                ...baseResult,
                value: "42bp",
                endedWithExpression: true,
            },
        });

        expect(log).toHaveBeenNthCalledWith(
            1,
            color(TERMINAL_DIM, "(no output)"),
        );
        expect(log).toHaveBeenNthCalledWith(2, color(TERMINAL_DIM, "42bp"));
    });

    it("prints valid sandbox failures", () => {
        const { log } = spyOnTerminalOutput();

        emitEvent({
            type: "code_execution_end",
            result: {
                success: false,
                errorType: "ValueError",
                message: "bad value",
                isTimeout: false,
            },
        });

        expect(log).toHaveBeenCalledWith(
            color(TERMINAL_DIM, "ValueError: bad value"),
        );
    });

    it.each([
        ["", "message", "Error type is missing!"],
        ["Type", "", "Error message is missing!"],
        ["T".repeat(3001), "message", "Error type is too long"],
        ["Type", "m".repeat(3001), "Error message is too long"],
    ])("fails loudly for invalid sandbox errors %#", (errorType, message, expectedError) => {
        spyOnTerminalOutput();

        expect(() =>
            emitEvent({
                type: "code_execution_end",
                result: {
                    success: false,
                    errorType,
                    message,
                    isTimeout: false,
                },
            }),
        ).toThrow(expectedError);
    });

    it("clears completed turns and prints cancellation", () => {
        const { write, log } = spyOnTerminalOutput();

        emitEvent({ type: "turn_end", text: "done", steps: [] });
        emitEvent({ type: "turn_cancelled" });
        emitEvent({ type: "llm_request_start" });

        expect(write).toHaveBeenNthCalledWith(1, TERMINAL_CLEAR_LINE);
        expect(write).toHaveBeenNthCalledWith(2, TERMINAL_CLEAR_LINE);
        expect(log).toHaveBeenCalledWith(color(TERMINAL_YELLOW, "[cancelled]"));
    });

    it("prints ordinary and timeout turn errors", () => {
        const { error } = spyOnTerminalOutput();

        emitEvent({
            type: "turn_error",
            error: "network down",
            isTimeout: false,
        });
        emitEvent({ type: "turn_error", error: "timed out", isTimeout: true });

        expect(error).toHaveBeenNthCalledWith(
            1,
            color(TERMINAL_RED, "Error: network down"),
        );
        expect(error).toHaveBeenNthCalledWith(
            2,
            color(
                TERMINAL_RED,
                "Error: LLM response timed out (i.e. a message from the LLM took too much time to arrive)",
            ),
        );
    });

    it.each([
        ["", "Error message is missing"],
        ["e".repeat(3001), "Error message is pathologically long"],
    ])("fails loudly for invalid turn errors %#", (error, expectedError) => {
        spyOnTerminalOutput();

        expect(() =>
            emitEvent({ type: "turn_error", error, isTimeout: false }),
        ).toThrow(expectedError);
    });
});
