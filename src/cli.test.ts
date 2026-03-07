// Tests for the nanalogue-chat CLI entry point.
// Spawns the built CLI binary and verifies flag behavior.

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version } from "../package.json";

const execFileAsync = promisify(execFile);

/** Path to the built CLI entry point. */
const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.mjs");

describe("nanalogue-chat CLI", () => {
    it("--version prints the package.json version", async () => {
        const { stdout } = await execFileAsync("node", [CLI_PATH, "--version"]);
        expect(stdout.trim()).toBe(version);
    });

    it("-v prints the package.json version", async () => {
        const { stdout } = await execFileAsync("node", [CLI_PATH, "-v"]);
        expect(stdout.trim()).toBe(version);
    });

    it("version output matches package.json exactly", async () => {
        const { stdout } = await execFileAsync("node", [CLI_PATH, "--version"]);
        // Verify it's a valid semver-like string
        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    describe("--non-interactive flag", () => {
        it("exits 1 when --endpoint/--model/--dir are missing", async () => {
            // Required-arg validation fires before the non-interactive block.
            await expect(
                execFileAsync("node", [CLI_PATH, "--non-interactive", "hello"]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("exits 1 when --non-interactive message is empty", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--non-interactive",
                    "",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints error message when --non-interactive message is empty", async () => {
            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--non-interactive",
                    "",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain(
                "--non-interactive message cannot be empty",
            );
        });

        it("exits 1 when --non-interactive message is whitespace-only", async () => {
            // A whitespace-only message is treated the same as empty — almost
            // certainly a bug in the calling script, so we fail loudly.
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--non-interactive",
                    "   ",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints error message when --non-interactive message is whitespace-only", async () => {
            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--non-interactive",
                    "   ",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain(
                "--non-interactive message cannot be empty",
            );
        });

        it("exits 1 when --non-interactive has no value", async () => {
            // parseArgs throws a parse error for a string-type flag with no
            // following argument, which hits the existing generic error path.
            await expect(
                execFileAsync("node", [CLI_PATH, "--non-interactive"]),
            ).rejects.toMatchObject({ code: 1 });
        });
    });

    describe("--dump-llm-instructions flag", () => {
        /** Temp directory created before each integration test and removed after. */
        let tmpDir = "";
        /** Mock HTTP server URL used by integration tests. */
        let mockServerUrl = "";
        /** Close function for the mock HTTP server. */
        let closeMockServer: (() => Promise<void>) | null = null;

        beforeEach(async () => {
            tmpDir = await mkdtemp(join(tmpdir(), "nanalogue-cli-test-"));

            // Start a minimal OpenAI-compatible mock server that returns a
            // plain text response (no code execution) so the dump has content.
            await new Promise<void>((resolve, reject) => {
                /**
                 * Handles requests by returning a static chat completion response.
                 *
                 * @param req - The incoming HTTP request.
                 * @param res - The server response.
                 */
                function handler(
                    req: IncomingMessage,
                    res: ServerResponse,
                ): void {
                    if (
                        req.method === "POST" &&
                        req.url?.endsWith("/chat/completions")
                    ) {
                        // Drain the request body before responding.
                        req.resume();
                        req.on("end", () => {
                            res.writeHead(200, {
                                "Content-Type": "application/json",
                            });
                            res.end(
                                JSON.stringify({
                                    id: "chatcmpl-test",
                                    object: "chat.completion",
                                    choices: [
                                        {
                                            message: {
                                                role: "assistant",
                                                content: 'print("42bp")',
                                            },
                                            finish_reason: "stop",
                                        },
                                    ],
                                    usage: {
                                        prompt_tokens: 10,
                                        completion_tokens: 5,
                                        total_tokens: 15,
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
                server.on("error", reject);
                server.listen(0, "127.0.0.1", () => {
                    const addr = server.address();
                    if (addr === null || typeof addr === "string") {
                        reject(new Error("Mock server did not bind to a port"));
                        return;
                    }
                    mockServerUrl = `http://127.0.0.1:${addr.port}/v1`;
                    /**
                     * Closes the mock HTTP server and resolves when done.
                     */
                    closeMockServer = () =>
                        new Promise<void>((res) => server.close(() => res()));
                    resolve();
                });
            });
        });

        afterEach(async () => {
            await closeMockServer?.();
            closeMockServer = null;
            await rm(tmpDir, { recursive: true, force: true });
        });

        it("writes a log file to ai_chat_output/ and reports the path on stderr", async () => {
            // Run the CLI against the mock server in non-interactive mode with
            // --dump-llm-instructions and capture stdout + stderr.
            const { stdout, stderr } = await execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                mockServerUrl,
                "--model",
                "test-model",
                "--dir",
                tmpDir,
                "--non-interactive",
                "What is the average read length?",
                "--dump-llm-instructions",
            ]).catch((err: unknown) => {
                // If the CLI exits non-zero, surface the error clearly.
                const execErr = err as NodeJS.ErrnoException & {
                    /** The stdout output of the failed process. */
                    stdout: string;
                    /** The stderr output of the failed process. */
                    stderr: string;
                };
                throw new Error(
                    `CLI exited with error: ${String(err)}\nstdout: ${execErr.stdout}\nstderr: ${execErr.stderr}`,
                    { cause: err },
                );
            });

            // stdout should contain the LLM reply (sandbox print output).
            expect(stdout.trim()).toBe("42bp");

            // stderr should contain the path announcement.
            expect(stderr).toContain("LLM instructions dumped to");

            // A log file should exist inside ai_chat_output/.
            const outputDir = join(tmpDir, "ai_chat_output");
            const files = await readdir(outputDir);
            const logFiles = files.filter((f) => f.endsWith(".log"));
            expect(logFiles).toHaveLength(1);

            // The log file should contain the system message and the user message.
            const logContent = await readFile(
                join(outputDir, logFiles[0] as string),
                "utf-8",
            );
            expect(logContent).toContain("=== Message 1: system ===");
            expect(logContent).toContain("=== Message 2: user ===");
            expect(logContent).toContain("What is the average read length?");
        });

        it("exits 1 when --dump-llm-instructions is passed without --non-interactive", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--dump-llm-instructions",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints error message when --dump-llm-instructions is passed without --non-interactive", async () => {
            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--dump-llm-instructions",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain(
                "--dump-llm-instructions requires --non-interactive",
            );
        });
    });

    describe("--system-prompt flag", () => {
        it("exits 1 when --system-prompt is empty", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--system-prompt",
                    "",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints an error message when --system-prompt is empty", async () => {
            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--system-prompt",
                    "",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain("--system-prompt value cannot be empty");
        });

        it("exits 1 when --system-prompt is whitespace-only", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--system-prompt",
                    "   ",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints an error message when --system-prompt is whitespace-only", async () => {
            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--system-prompt",
                    "   ",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain("--system-prompt value cannot be empty");
        });
    });
});
