// Tests for the nanalogue-chat CLI entry point.
// Spawns the built CLI binary and verifies flag behavior, including
// interactive REPL mode via stdin/stdout.

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
    createServer,
    type IncomingMessage,
    type RequestListener,
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

/** Local HTTP endpoint and cleanup callback for a CLI integration test. */
interface CliTestServer {
    /** OpenAI-compatible base endpoint URL. */
    endpointUrl: string;
    /** Stops the local test server. */
    close: () => Promise<void>;
}

/**
 * Starts a local HTTP server for strict CLI integration tests.
 *
 * @param handler - Request handler for the test-specific response.
 * @returns The endpoint URL and an asynchronous cleanup callback.
 */
async function startCliTestServer(
    handler: RequestListener,
): Promise<CliTestServer> {
    return await new Promise<CliTestServer>((resolve, reject) => {
        const server = createServer(handler);
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                reject(new Error("CLI test server did not bind to a port"));
                return;
            }
            const close = promisify(server.close.bind(server));
            resolve({
                endpointUrl: `http://127.0.0.1:${address.port}/v1`,
                close,
            });
        });
    });
}

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

    describe("strict assertion checks", () => {
        it("rejects malformed endpoint URLs", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "https:///example.com/v1",
                    "--list-models",
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("Invalid endpoint URL!"),
            });
        });

        it("rejects API keys longer than 200 characters", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--api-key",
                    "k".repeat(201),
                    "--list-models",
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("Invalid API key"),
            });
        });

        it("rejects model names with surrounding whitespace", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    " model",
                    "--dir",
                    ".",
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("Invalid model name!"),
            });
        });

        it("rejects provider error bodies longer than 3000 characters", async () => {
            const server = await startCliTestServer((_req, res) => {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("e".repeat(3001));
            });

            try {
                await expect(
                    execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        server.endpointUrl,
                        "--model",
                        "test-model",
                        "--dir",
                        ".",
                        "--non-interactive",
                        "hello",
                    ]),
                ).rejects.toMatchObject({
                    code: 1,
                    stderr: expect.stringContaining(
                        "Error message is pathologically long",
                    ),
                });
            } finally {
                await server.close();
            }
        });

        it.each([
            [
                { data: [{ id: "m".repeat(201) }] },
                "Model string is pathological",
            ],
            [{ data: [{}] }, "Model identifier is not a string!"],
        ])("rejects malformed model-list responses %#", async (responseBody, expectedError) => {
            const server = await startCliTestServer((_req, res) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(responseBody));
            });

            try {
                await expect(
                    execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        server.endpointUrl,
                        "--list-models",
                    ]),
                ).rejects.toMatchObject({
                    code: 1,
                    stderr: expect.stringContaining(expectedError),
                });
            } finally {
                await server.close();
            }
        });
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

    describe("non-interactive dump flags", () => {
        /** Temp directory created before each integration test and removed after. */
        let tmpDir = "";
        /** Mock HTTP server URL used by integration tests. */
        let mockServerUrl = "";
        /** Close function for the mock HTTP server. */
        let closeMockServer: (() => Promise<void>) | null = null;
        /** Captured JSON request bodies sent to the mock HTTP server. */
        let requestBodies: Array<Record<string, unknown>> = [];

        beforeEach(async () => {
            tmpDir = await mkdtemp(join(tmpdir(), "nanalogue-cli-test-"));
            requestBodies = [];

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
                        const chunks: Buffer[] = [];
                        req.on("data", (chunk: Buffer) => {
                            chunks.push(chunk);
                        });
                        req.on("end", () => {
                            const rawBody =
                                Buffer.concat(chunks).toString("utf-8");
                            if (rawBody.trim()) {
                                requestBodies.push(JSON.parse(rawBody));
                            }
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

            // stderr should contain the path announcement for both files.
            expect(stderr).toContain("LLM instructions dumped to");
            expect(stderr).toContain("HTML view:");

            // Both a .log and a .html file should exist inside ai_chat_output/.
            const outputDir = join(tmpDir, "ai_chat_output");
            const files = await readdir(outputDir);
            const logFiles = files.filter((f) => f.endsWith(".log"));
            expect(logFiles).toHaveLength(1);
            const htmlFiles = files.filter((f) => f.endsWith(".html"));
            expect(htmlFiles).toHaveLength(1);

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

        it("writes raw history without a system message for --dump-history", async () => {
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
                "--dump-history",
            ]);

            expect(stdout.trim()).toBe("42bp");
            expect(stderr).toContain("Conversation history dumped to");
            expect(stderr).toContain("HTML view:");

            const outputDir = join(tmpDir, "ai_chat_output");
            const files = await readdir(outputDir);
            const logFile = files.find((file) => file.endsWith(".log"));
            const htmlFile = files.find((file) => file.endsWith(".html"));
            expect(logFile).toMatch(/^nanalogue-history-.+\.log$/);
            expect(htmlFile).toMatch(/^nanalogue-history-.+\.html$/);
            if (!logFile) {
                throw new Error("Expected a conversation history log file");
            }

            const logContent = await readFile(
                join(outputDir, logFile),
                "utf-8",
            );
            expect(logContent).toContain("=== Message 1: user ===");
            expect(logContent).toContain("What is the average read length?");
            expect(logContent).toContain("=== Message 2: assistant ===");
            expect(logContent).not.toContain(": system ===");
            expect(logContent).not.toContain("isExecutionResult");
            expect(logContent).not.toContain("executionStatus");
        });

        it("rejects --dump-history without --non-interactive", async () => {
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
                    "--dump-history",
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
                "--dump-history requires --non-interactive",
            );
        });

        it("sends a user message and the sandbox output appears on stdout", async () => {
            // Runs the CLI in non-interactive mode against the mock server.
            // The mock returns print("42bp") which the sandbox executes, so
            // stdout should contain exactly "42bp".
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                mockServerUrl,
                "--model",
                "test-model",
                "--dir",
                tmpDir,
                "--non-interactive",
                "hello",
            ]);
            expect(stdout.trim()).toBe("42bp");
        });

        it("exits with code 0 after a successful non-interactive turn", async () => {
            // execFileAsync rejects on non-zero exit codes, so resolving
            // is sufficient to assert exit 0.
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    mockServerUrl,
                    "--model",
                    "test-model",
                    "--dir",
                    tmpDir,
                    "--non-interactive",
                    "hello",
                ]),
            ).resolves.toBeDefined();
        });

        /** Request body shape used by the mock chat server. */
        interface MockChatRequestBody {
            /** Chat messages sent to the LLM. */
            messages?: Array<{
                /** Message role. */
                role?: string;
                /** Message content. */
                content?: string;
            }>;
        }

        it("supports --only-system-append on a directory with SYSTEM_APPEND.md", async () => {
            await writeFile(
                join(tmpDir, "SYSTEM_APPEND.md"),
                "## Domain context\nFocus on CpG methylation.",
                "utf-8",
            );
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                mockServerUrl,
                "--model",
                "test-model",
                "--dir",
                tmpDir,
                "--only-system-append",
                "--non-interactive",
                "hello",
            ]);
            expect(stdout.trim()).toBe("42bp");

            const firstBody = requestBodies[0] as MockChatRequestBody;
            expect(firstBody.messages?.[0]?.role).toBe("system");
            expect(firstBody.messages?.[0]?.content).toBe(
                "## Domain context\nFocus on CpG methylation.",
            );
        });

        it("continues to support --system-prompt", async () => {
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--endpoint",
                mockServerUrl,
                "--model",
                "test-model",
                "--dir",
                tmpDir,
                "--system-prompt",
                "You are a custom assistant.",
                "--non-interactive",
                "hello",
            ]);
            expect(stdout.trim()).toBe("42bp");

            const firstBody = requestBodies[0] as MockChatRequestBody;
            expect(firstBody.messages?.[0]?.content).toBe(
                "You are a custom assistant.",
            );
        });
    });

    describe("--rm-tools flag", () => {
        it("exits 1 when --rm-tools value is empty", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--rm-tools",
                    "",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints error when --rm-tools value is empty", async () => {
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
                    "--rm-tools",
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
            expect(stderr).toContain("--rm-tools value cannot be empty");
        });

        it("exits 1 when --rm-tools contains an unknown tool name", async () => {
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--endpoint",
                    "http://localhost:11434/v1",
                    "--model",
                    "llama3",
                    "--dir",
                    ".",
                    "--rm-tools",
                    "nonexistent_tool",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints error naming the bad tool when --rm-tools contains an unknown name", async () => {
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
                    "--rm-tools",
                    "nonexistent_tool",
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain('"nonexistent_tool"');
        });

        it("exits 1 when --rm-tools value contains a space after a comma", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "rm-tools-"));
            try {
                await writeFile(
                    join(tmpDir, "SYSTEM_APPEND.md"),
                    "## Prompt base",
                    "utf-8",
                );
                await expect(
                    execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--only-system-append",
                        "--rm-tools",
                        "peek, ls",
                    ]),
                ).rejects.toMatchObject({ code: 1 });
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("prints error naming the space-padded tool when --rm-tools has a space after comma", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "rm-tools-"));
            try {
                await writeFile(
                    join(tmpDir, "SYSTEM_APPEND.md"),
                    "## Prompt base",
                    "utf-8",
                );
                let stderr = "";
                try {
                    await execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--only-system-append",
                        "--rm-tools",
                        "peek, ls",
                    ]);
                } catch (err) {
                    stderr = (
                        err as NodeJS.ErrnoException & {
                            /** The stderr output of the failed process. */
                            stderr: string;
                        }
                    ).stderr;
                }
                expect(stderr).toContain('" ls"');
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("exits 1 when --rm-tools is used without a replacement prompt", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "rm-tools-"));
            try {
                await expect(
                    execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--rm-tools",
                        "peek",
                    ]),
                ).rejects.toMatchObject({ code: 1 });
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("prints error when --rm-tools is used without a replacement prompt", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "rm-tools-"));
            try {
                let stderr = "";
                try {
                    await execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--rm-tools",
                        "peek",
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
                    "--rm-tools requires --system-prompt or --only-system-append",
                );
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });
    });

    describe("--system-prompt flag", () => {
        it.each([
            "",
            "   ",
        ])("rejects an empty or whitespace-only value %#", async (systemPrompt) => {
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
                    systemPrompt,
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining(
                    "--system-prompt value cannot be empty",
                ),
            });
        });
    });

    describe("--only-system-append flag", () => {
        it("rejects combining --only-system-append with --system-prompt", async () => {
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
                    "custom",
                    "--only-system-append",
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("exits 1 when --only-system-append is used without SYSTEM_APPEND.md", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "only-system-append-"));
            try {
                await expect(
                    execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--only-system-append",
                    ]),
                ).rejects.toMatchObject({ code: 1 });
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });

        it("prints an error message when --only-system-append is used without SYSTEM_APPEND.md", async () => {
            const tmpDir = await mkdtemp(join(tmpdir(), "only-system-append-"));
            try {
                let stderr = "";
                try {
                    await execFileAsync("node", [
                        CLI_PATH,
                        "--endpoint",
                        "http://localhost:11434/v1",
                        "--model",
                        "llama3",
                        "--dir",
                        tmpDir,
                        "--only-system-append",
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
                    "--only-system-append requires SYSTEM_APPEND.md to exist and be non-empty",
                );
            } finally {
                await rm(tmpDir, { recursive: true, force: true });
            }
        });
    });

    // -----------------------------------------------------------------------
    // REPL interactive mode — stdin/stdout integration tests.
    // These tests spawn the CLI with piped stdio, write commands to stdin,
    // and collect stdout to verify the interactive REPL loop behaviour.
    // -----------------------------------------------------------------------

    /** Result shape returned by the REPL helper functions below. */
    interface ReplResult {
        /** All text written to stdout by the spawned CLI process. */
        stdout: string;
        /** The process exit code, or null if the process was killed. */
        code: number | null;
    }

    // -----------------------------------------------------------------------
    // Numeric flag validation — invalid values must be rejected with a clear
    // error message rather than silently clamped to the nearest bound.
    // -----------------------------------------------------------------------

    describe("numeric flag validation", () => {
        /**
         * Runs the CLI with the given args and captures stderr.
         * The process is expected to exit with code 1.
         *
         * @param args - Full CLI argument list.
         * @returns The stderr output of the failed process.
         */
        async function stderrOf(args: string[]): Promise<string> {
            let stderr = "";
            try {
                await execFileAsync("node", args);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** The stderr output of the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            return stderr;
        }

        /** Baseline valid args shared across numeric-flag tests. */
        const baseArgs = [
            CLI_PATH,
            "--endpoint",
            "http://localhost:11434/v1",
            "--model",
            "llama3",
            "--dir",
            ".",
        ];

        it("exits 1 when a numeric flag is below its minimum", async () => {
            await expect(
                execFileAsync("node", [...baseArgs, "--timeout", "0"]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints a descriptive error when a numeric flag is below its minimum", async () => {
            const stderr = await stderrOf([...baseArgs, "--timeout", "0"]);
            expect(stderr).toContain("--timeout");
            expect(stderr).toContain("below the minimum");
        });

        it("exits 1 when a numeric flag is above its maximum", async () => {
            await expect(
                execFileAsync("node", [...baseArgs, "--timeout", "99999"]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("reports all invalid numeric flags at once when multiple are bad", async () => {
            const stderr = await stderrOf([
                ...baseArgs,
                "--timeout",
                "0",
                "--max-duration-secs",
                "99999999",
                "--max-memory-mb",
                "banana",
            ]);
            expect(stderr).toContain("--timeout");
            expect(stderr).toContain("--max-duration-secs");
            expect(stderr).toContain("--max-memory-mb");
        });
    });

    describe("REPL interactive mode", () => {
        /** Temp directory created before each test and cleaned up after. */
        let tmpDir = "";

        beforeEach(async () => {
            tmpDir = await mkdtemp(join(tmpdir(), "nanalogue-cli-repl-test-"));
        });

        afterEach(async () => {
            await rm(tmpDir, { recursive: true, force: true });
        });

        /**
         * Spawns the CLI in interactive mode, writes commands to stdin, and
         * collects stdout + exit code.  Closes stdin after writing so the
         * readline `for await` loop terminates naturally when the process has
         * consumed all input.
         *
         * @param args - Extra CLI arguments (endpoint, model, dir are required).
         * @param commands - Lines to write to stdin, one per element.
         * @param timeoutMs - Kill the process after this many ms if still running.
         * @returns Collected stdout and the process exit code.
         */
        async function runInteractiveCli(
            args: string[],
            commands: string[],
            timeoutMs = 15_000,
        ): Promise<ReplResult> {
            return new Promise((resolve, reject) => {
                const proc = spawn("node", [CLI_PATH, ...args], {
                    stdio: ["pipe", "pipe", "pipe"],
                });

                let stdout = "";
                let stderr = "";

                proc.stdout.on("data", (chunk: Buffer) => {
                    stdout += chunk.toString();
                });
                proc.stderr.on("data", (chunk: Buffer) => {
                    stderr += chunk.toString();
                });

                const timer = setTimeout(() => {
                    proc.kill();
                    reject(
                        new Error(
                            `CLI timed out after ${timeoutMs}ms\n` +
                                `stdout: ${stdout}\nstderr: ${stderr}`,
                        ),
                    );
                }, timeoutMs);

                proc.on("close", (code) => {
                    clearTimeout(timer);
                    resolve({ stdout, code });
                });

                proc.on("error", (err) => {
                    clearTimeout(timer);
                    reject(err);
                });

                // Write all commands, then close stdin so readline ends.
                for (const cmd of commands) {
                    proc.stdin.write(`${cmd}\n`);
                }
                proc.stdin.end();
            });
        }

        /**
         * Standard REPL flags that are always required for interactive mode.
         *
         * @param dir - The analysis directory path to pass as --dir.
         * @returns The argument array for the CLI invocation.
         */
        function replArgs(dir: string): string[] {
            return [
                "--endpoint",
                "http://127.0.0.1:19999/v1",
                "--model",
                "test-model",
                "--dir",
                dir,
            ];
        }

        it("/quit exits with code 0 and prints Goodbye!", async () => {
            const { stdout, code } = await runInteractiveCli(replArgs(tmpDir), [
                "/quit",
            ]);
            expect(code).toBe(0);
            expect(stdout).toContain("Goodbye!");
        });

        it("/new prints [new conversation started]", async () => {
            const { stdout } = await runInteractiveCli(replArgs(tmpDir), [
                "/new",
                "/quit",
            ]);
            expect(stdout).toContain("[new conversation started]");
        });

        it("banner includes the endpoint URL and model name", async () => {
            const { stdout } = await runInteractiveCli(
                [
                    "--endpoint",
                    "http://127.0.0.1:19999/v1",
                    "--model",
                    "banner-model",
                    "--dir",
                    tmpDir,
                ],
                ["/quit"],
            );
            expect(stdout).toContain("http://127.0.0.1:19999/v1");
            expect(stdout).toContain("banner-model");
        });

        it("banner includes the analysis directory path", async () => {
            const { stdout } = await runInteractiveCli(replArgs(tmpDir), [
                "/quit",
            ]);
            expect(stdout).toContain(tmpDir);
        });

        it("SYSTEM_APPEND.md presence is reflected in the startup banner", async () => {
            // Write a SYSTEM_APPEND.md into the analysis dir, then start the
            // CLI and quit immediately — the banner should note it was loaded.
            const { writeFile } = await import("node:fs/promises");
            await writeFile(
                join(tmpDir, "SYSTEM_APPEND.md"),
                "## Extra context\nFocus on CpG islands.",
                "utf-8",
            );
            const { stdout } = await runInteractiveCli(replArgs(tmpDir), [
                "/quit",
            ]);
            expect(stdout).toContain("SYSTEM_APPEND.md");
        });
    });
});
