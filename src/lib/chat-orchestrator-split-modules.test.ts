// Unit tests for split chat-orchestrator helper modules.
// Covers helper-module branches directly.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_MAX_COMPLETION_TOKENS,
    FEEDBACK_OUTPUT_MAX_BYTES,
    TERMINAL_OUTPUT_OVERFLOW_BYTES,
} from "./ai-chat-constants";
import {
    buildExecutionFeedback,
    buildMalformedAssistantProtocolFeedback,
    detectMalformedAssistantProtocol,
    handleTerminalOverflow,
    runSandboxGuarded,
} from "./chat-orchestrator-execution";
import {
    deriveEstimatedBytesPerToken,
    fetchChatCompletion,
} from "./chat-orchestrator-llm";

describe("chat-orchestrator-execution helpers", () => {
    const tmpPaths: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tmpPaths
                .splice(0)
                .map((path) => rm(path, { recursive: true, force: true })),
        );
    });

    it("returns small terminal output unchanged", async () => {
        const tmpPath = await mkdtemp(join(tmpdir(), "chat-overflow-"));
        tmpPaths.push(tmpPath);
        await expect(handleTerminalOverflow("ok", tmpPath)).resolves.toBe("ok");
    });

    it("writes oversized terminal output to ai_chat_output", async () => {
        const tmpPath = await mkdtemp(join(tmpdir(), "chat-overflow-"));
        tmpPaths.push(tmpPath);
        const text = "x".repeat(TERMINAL_OUTPUT_OVERFLOW_BYTES + 1);

        const result = await handleTerminalOverflow(text, tmpPath);

        expect(result).toMatch(
            /^Output too large \(\d+ bytes\)\. Full output saved to ai_chat_output\/.+\.txt in the allowed directory\.$/,
        );
    });

    it("returns a fallback message when overflow output cannot be written", async () => {
        const dir = await mkdtemp(join(tmpdir(), "chat-overflow-file-"));
        const filePath = join(dir, "not-a-directory");
        await writeFile(filePath, "x", "utf-8");
        tmpPaths.push(dir);

        const text = "x".repeat(TERMINAL_OUTPUT_OVERFLOW_BYTES + 1);
        const result = await handleTerminalOverflow(text, filePath);

        expect(result).toContain("could not write to file");
    });

    it("detects native tool, reasoning, and simulated execution markup", () => {
        expect(
            detectMalformedAssistantProtocol(
                '<tool_calls>\n<invoke name="ls">\n' +
                    '<parameter name="pattern">**/*.bam</parameter>\n' +
                    "</invoke>\n</tool_calls>",
            ),
        ).toBe("native_tool_markup");
        expect(
            detectMalformedAssistantProtocol("files = ls()\nfiles\n</think>"),
        ).toBe("reasoning_markup");
        expect(
            detectMalformedAssistantProtocol(
                "<think>inspect files</think>\nfiles = ls()\nfiles",
            ),
        ).toBe("reasoning_markup");
        expect(
            detectMalformedAssistantProtocol(
                "files = ls()\nCode execution result (get_ai_response):\n['x.bam']",
            ),
        ).toBe("simulated_execution_transcript");
    });

    it("allows direct Python and protocol-like text in strings or comments", () => {
        expect(
            detectMalformedAssistantProtocol('files = ls("**/*.bam")\nfiles'),
        ).toBeNull();
        expect(
            detectMalformedAssistantProtocol(
                '# <tool_calls> is invalid\nprint("Code execution result: example")\n' +
                    'example = """\n<think>example</think>\n' +
                    '<invoke name="ls">\n</invoke>\n"""\n' +
                    "print(example)",
            ),
        ).toBeNull();
    });

    it("builds focused malformed-protocol repair feedback", () => {
        const feedback = buildMalformedAssistantProtocolFeedback(
            "native_tool_markup",
            2,
        );
        const payload = JSON.parse(
            feedback.replace("Code execution result: ", ""),
        ) as Record<string, unknown>;

        expect(payload.error_type).toBe("MalformedAssistantProtocol");
        expect(payload.protocol).toBe("native_tool_markup");
        expect(payload.message).toContain('files = ls("**/*.bam")\nfiles');
        expect(payload.rounds_remaining).toBe(2);
    });

    it("builds repair feedback for leaked reasoning markup", () => {
        const feedback = buildMalformedAssistantProtocolFeedback(
            "reasoning_markup",
            2,
        );
        const payload = JSON.parse(
            feedback.replace("Code execution result: ", ""),
        ) as Record<string, unknown>;

        expect(payload.protocol).toBe("reasoning_markup");
        expect(payload.message).toContain("<think>");
        expect(payload.message).toContain("</think>");
    });

    it("marks oversized expression values as truncated", () => {
        const feedback = buildExecutionFeedback(
            {
                success: true,
                endedWithExpression: true,
                value: "x".repeat(FEEDBACK_OUTPUT_MAX_BYTES),
            },
            2,
        );

        const payload = JSON.parse(
            feedback.replace("Code execution result: ", ""),
        ) as Record<string, unknown>;
        expect(payload.value_truncated).toBe(true);
        expect(String(payload.value)).toContain("...(truncated)");
    });

    it("rejects while waiting for the sandbox lock when already aborted", async () => {
        const mod = await import("./chat-orchestrator-execution");
        const firstDir = await mkdtemp(join(tmpdir(), "chat-lock-"));
        const secondDir = await mkdtemp(join(tmpdir(), "chat-lock-"));
        tmpPaths.push(firstDir, secondDir);
        const first = mod.runSandboxGuarded(
            "import time; time.sleep(0.2)",
            firstDir,
            {},
        );
        const controller = new AbortController();
        controller.abort(new Error("aborted while waiting"));

        await expect(
            mod.runSandboxGuarded("1 + 1", secondDir, {}, controller.signal),
        ).rejects.toThrow("aborted while waiting");

        await first;
    });

    it("rejects after taking the lock when abort arrives in the post-lock check", async () => {
        let abortedChecks = 0;
        const signal = {
            /**
             * Reports an abort only after the lock has been acquired.
             *
             * @returns Whether the synthetic signal is aborted.
             */
            get aborted() {
                abortedChecks += 1;
                return abortedChecks >= 2;
            },
            reason: new Error("aborted after lock"),
        } as AbortSignal;

        await expect(
            runSandboxGuarded("1 + 1", ".", {}, signal),
        ).rejects.toThrow("aborted after lock");
    });
});

describe("chat-orchestrator-llm helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("applies provider payload adjustments before transport", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            /**
             * Returns a minimal successful completion payload.
             *
             * @returns A minimal completion response.
             */
            json: async () => ({
                choices: [
                    {
                        message: { role: "assistant", content: "ok" },
                        finish_reason: "stop",
                    },
                ],
            }),
        } as Response);

        await fetchChatCompletion(
            "https://api.mistral.ai/v1",
            "",
            "test-model",
            "system",
            [{ role: "user", content: "hello" }],
            0,
            new AbortController().signal,
        );

        const body = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;
        expect(body.max_tokens).toBe(DEFAULT_MAX_COMPLETION_TOKENS);
        expect(body.max_completion_tokens).toBeUndefined();
    });

    it("retries network failures and rethrows the last error", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
            new Error("network down"),
        );

        await expect(
            fetchChatCompletion(
                "http://127.0.0.1:1/v1",
                "",
                "test-model",
                "system",
                [{ role: "user", content: "hello" }],
                1,
                new AbortController().signal,
            ),
        ).rejects.toThrow("network down");
    });

    it("derives bytes per token from non-empty prompt content", () => {
        expect(
            deriveEstimatedBytesPerToken(
                "abcd",
                [{ role: "user", content: "efgh" }],
                2,
            ),
        ).toBe(4);
    });

    it("returns null when prompt token count is missing or prompt bytes are zero", () => {
        expect(deriveEstimatedBytesPerToken("", [], undefined)).toBeNull();
        expect(deriveEstimatedBytesPerToken("", [], 1)).toBeNull();
    });

    it("rejects immediately when retry sleep starts with an aborted signal", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: false,
            status: 500,
            /**
             * Returns a retryable server-error body.
             *
             * @returns The mock response body.
             */
            text: async () => "server error",
            headers: new Headers(),
        } as Response);

        const signal = {
            aborted: true,
            reason: new Error("aborted before sleep"),
        } as AbortSignal;

        await expect(
            fetchChatCompletion(
                "https://example.test/v1",
                "",
                "test-model",
                "system",
                [{ role: "user", content: "hello" }],
                1,
                signal,
            ),
        ).rejects.toThrow("aborted before sleep");
    });
});
