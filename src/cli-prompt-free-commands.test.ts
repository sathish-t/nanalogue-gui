// Integration tests for CLI commands that do not consume a system prompt.

import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.mjs");

/**
 * Waits for a marker in output produced after this call.
 *
 * @param child - Interactive CLI child process.
 * @param getOutput - Returns collected stdout.
 * @param marker - Output marker expected from the next command.
 * @returns A promise resolved when the marker is observed.
 */
function waitForNewStdout(
    child: ReturnType<typeof spawn>,
    getOutput: () => string,
    marker: string,
): Promise<void> {
    const start = getOutput().length;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.stdout.off("data", checkOutput);
            reject(new Error(`CLI stdout did not contain: ${marker}`));
        }, 15_000);
        /** Resolves once newly collected output contains the marker. */
        function checkOutput(): void {
            if (getOutput().slice(start).includes(marker)) {
                clearTimeout(timer);
                child.stdout.off("data", checkOutput);
                resolve();
            }
        }
        child.stdout.on("data", checkOutput);
        checkOutput();
    });
}

describe("nanalogue-chat prompt-free non-interactive commands", () => {
    let analysisDir = "";

    beforeEach(async () => {
        analysisDir = await mkdtemp(join(tmpdir(), "cli-prompt-free-"));
        await writeFile(join(analysisDir, "SYSTEM_APPEND.md"), "");
        await writeFile(join(analysisDir, "answer.py"), 'print("42bp")');
    });

    afterEach(async () => {
        await rm(analysisDir, { recursive: true, force: true });
    });

    it.each([
        ["/exec answer.py", "42bp"],
        ["/dump_history", "No conversation history yet"],
        ["/dump_llm_instructions", "No LLM call has been made yet"],
    ])("runs %s without reading malformed SYSTEM_APPEND.md", async (message, expectedOutput) => {
        const { stdout } = await execFileAsync("node", [
            CLI_PATH,
            "--endpoint",
            "http://localhost:11434/v1",
            "--model",
            "test-model",
            "--dir",
            analysisDir,
            "--only-system-append",
            "--non-interactive",
            message,
        ]);

        expect(stdout).toContain(expectedOutput);
    });

    it("normalizes surrounding whitespace before classifying and dispatching", async () => {
        const { stdout } = await execFileAsync("node", [
            CLI_PATH,
            "--endpoint",
            "http://localhost:11434/v1",
            "--model",
            "test-model",
            "--dir",
            analysisDir,
            "--only-system-append",
            "--non-interactive",
            "  /dump_history  ",
        ]);

        expect(stdout).toContain("No conversation history yet");
    });

    it.each([
        "/exec",
        "/dump_history extra",
        "/dump_llm_instructions extra",
    ])("treats malformed command lookalike %s as prompt-using", async (message) => {
        await expect(
            execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                "http://localhost:11434/v1",
                "--model",
                "test-model",
                "--dir",
                analysisDir,
                "--only-system-append",
                "--non-interactive",
                message,
            ]),
        ).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining(
                "SYSTEM_APPEND.md must not be empty",
            ),
        });
    });

    it("runs all prompt-free commands in the REPL without loading the append file", async () => {
        const child = spawn(
            "node",
            [
                CLI_PATH,
                "--endpoint",
                "http://localhost:11434/v1",
                "--model",
                "test-model",
                "--dir",
                analysisDir,
                "--only-system-append",
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        await waitForNewStdout(child, () => stdout, "You:");
        let commandComplete = waitForNewStdout(child, () => stdout, "You:");
        child.stdin.write("/exec answer.py\n");
        await commandComplete;
        commandComplete = waitForNewStdout(child, () => stdout, "You:");
        child.stdin.write("/dump_history\n");
        await commandComplete;
        commandComplete = waitForNewStdout(child, () => stdout, "You:");
        child.stdin.write("/dump_llm_instructions\n");
        await commandComplete;
        child.stdin.end("/quit\n");

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", resolve);
        });

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toContain("42bp");
        expect(stdout).toContain("No conversation history yet");
        expect(stdout).toContain("No LLM call has been made yet");
    });

    it("still rejects an explicitly malformed system prompt", async () => {
        await expect(
            execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                "http://localhost:11434/v1",
                "--model",
                "test-model",
                "--dir",
                analysisDir,
                "--system-prompt",
                "",
                "--non-interactive",
                "/dump_history",
            ]),
        ).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining(
                "--system-prompt value cannot be empty",
            ),
        });
    });
});
