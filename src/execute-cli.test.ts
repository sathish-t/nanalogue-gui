// Tests for the nanalogue-sandbox-exec CLI entry point.
// Spawns the built binary and verifies flag handling, validation, and
// basic script execution. Requires `npm run build` to have run first.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version } from "../package.json";
import { MAX_PYTHON_SOURCE_BYTES } from "./lib/ai-chat-shared-constants";

const execFileAsync = promisify(execFile);

/** Path to the built execute-cli entry point. */
const CLI_PATH = join(import.meta.dirname, "..", "dist", "execute-cli.mjs");

/** Temporary directory created per-test; removed in afterEach. */
let tmpDir = "";

describe("nanalogue-sandbox-exec CLI", () => {
    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "nanalogue-exec-test-"));
    });

    afterEach(async () => {
        if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true });
            tmpDir = "";
        }
    });

    // -------------------------------------------------------------------------
    // Version flag
    // -------------------------------------------------------------------------

    describe("--version / -v", () => {
        it("--version prints the package.json version", async () => {
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--version",
            ]);
            expect(stdout.trim()).toBe(version);
        });

        it("-v prints the package.json version", async () => {
            const { stdout } = await execFileAsync("node", [CLI_PATH, "-v"]);
            expect(stdout.trim()).toBe(version);
        });

        it("version string matches semver format", async () => {
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--version",
            ]);
            expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
        });
    });

    // -------------------------------------------------------------------------
    // Help flag
    // -------------------------------------------------------------------------

    describe("--help / -h", () => {
        it("--help prints usage information", async () => {
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--help",
            ]);
            expect(stdout).toContain("nanalogue-sandbox-exec");
            expect(stdout).toContain("--dir");
        });

        it("-h prints usage information", async () => {
            const { stdout } = await execFileAsync("node", [CLI_PATH, "-h"]);
            expect(stdout).toContain("nanalogue-sandbox-exec");
        });

        it("help output documents --max-output-bytes", async () => {
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--help",
            ]);
            expect(stdout).toContain("--max-output-bytes");
        });
    });

    // -------------------------------------------------------------------------
    // Required argument validation
    // -------------------------------------------------------------------------

    describe("argument validation", () => {
        it("exits 1 when --dir is missing", async () => {
            const scriptPath = join(tmpDir, "script.py");
            await writeFile(scriptPath, "");
            await expect(
                execFileAsync("node", [CLI_PATH, scriptPath]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("prints an error when --dir is missing", async () => {
            const scriptPath = join(tmpDir, "script.py");
            await writeFile(scriptPath, "");
            let stderr = "";
            try {
                await execFileAsync("node", [CLI_PATH, scriptPath]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** Captured stderr from the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain("--dir");
        });

        it("exits 1 when no script path is supplied", async () => {
            await expect(
                execFileAsync("node", [CLI_PATH, "--dir", tmpDir]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("exits 1 when more than one positional is supplied", async () => {
            const s1 = join(tmpDir, "a.py");
            const s2 = join(tmpDir, "b.py");
            await writeFile(s1, "");
            await writeFile(s2, "");
            await expect(
                execFileAsync("node", [CLI_PATH, "--dir", tmpDir, s1, s2]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("exits 1 when the script does not have a .py extension", async () => {
            const scriptPath = join(tmpDir, "script.sh");
            await writeFile(scriptPath, "");
            await expect(
                execFileAsync("node", [CLI_PATH, "--dir", tmpDir, scriptPath]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("exits 1 when --max-output-bytes is not a positive number", async () => {
            const scriptPath = join(tmpDir, "script.py");
            await writeFile(scriptPath, "");
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    tmpDir,
                    "--max-output-bytes",
                    "-5",
                    scriptPath,
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringMatching(/^Error:/),
            });
        });

        it("exits 1 when the script file does not exist", async () => {
            const missingScript = join(tmpDir, "missing.py");
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    tmpDir,
                    missingScript,
                ]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("rejects a repeated option", async () => {
            await expect(
                execFileAsync("node", [CLI_PATH, "--help", "--help"]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("may only be supplied once"),
            });
        });

        it.each([
            "1.5",
            "1e3",
            "0x10",
            "+10",
            " 10",
        ])("rejects non-canonical --max-output-bytes value %j", async (value) => {
            const scriptPath = join(tmpDir, "script.py");
            await writeFile(scriptPath, "");
            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    tmpDir,
                    "--max-output-bytes",
                    value,
                    scriptPath,
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringMatching(/^Error:/),
            });
        });

        it("rejects an analysis path that is a regular file", async () => {
            const scriptPath = join(tmpDir, "script.py");
            const filePath = join(tmpDir, "not-a-directory");
            await writeFile(scriptPath, "");
            await writeFile(filePath, "content");

            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    filePath,
                    scriptPath,
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("must identify a directory"),
            });
        });

        it("rejects a directory masquerading as a Python file", async () => {
            const scriptDirectory = join(tmpDir, "script.py");
            await mkdir(scriptDirectory);

            await expect(
                execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    tmpDir,
                    scriptDirectory,
                ]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("regular file"),
            });
        });

        it("rejects Python source above the 10 MiB limit", async () => {
            const scriptPath = join(tmpDir, "large.py");
            await writeFile(
                scriptPath,
                "x".repeat(MAX_PYTHON_SOURCE_BYTES + 1),
            );

            await expect(
                execFileAsync("node", [CLI_PATH, "--dir", tmpDir, scriptPath]),
            ).rejects.toMatchObject({
                code: 1,
                stderr: expect.stringContaining("10 MiB limit"),
            });
        });
    });

    // -------------------------------------------------------------------------
    // Successful execution
    // -------------------------------------------------------------------------

    describe("successful execution", () => {
        it("exits 0 for a silent script (no print)", async () => {
            const scriptPath = join(tmpDir, "silent.py");
            await writeFile(scriptPath, "x = 1 + 1\n");

            const result = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                scriptPath,
            ]);

            expect(result.stdout).toBe("");
        });

        it("exits 0 and writes print output to stdout", async () => {
            const scriptPath = join(tmpDir, "hello.py");
            await writeFile(scriptPath, 'print("hello from sandbox")\n');

            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                scriptPath,
            ]);

            expect(stdout).toContain("hello from sandbox");
        });

        it("saves complete prints when --max-output-bytes is exceeded", async () => {
            const scriptPath = join(tmpDir, "big.py");
            // Print enough output that it exceeds a tiny byte limit.
            await writeFile(scriptPath, 'print("A" * 200)\n');

            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                "--max-output-bytes",
                "50",
                scriptPath,
            ]);

            const path = stdout.match(
                /ai_chat_output\/python-prints-[\w-]+\.txt/,
            )?.[0];
            expect(path).toBeDefined();
            expect(await readFile(join(tmpDir, path ?? ""), "utf-8")).toBe(
                `${"A".repeat(200)}\n`,
            );
            expect(stdout).not.toContain("A".repeat(100));
        });

        it.each([
            ["42", "42", "2"],
            ['"🧬"', '"🧬"', "6"],
        ])("preserves the inline value %s at its exact byte boundary", async (code, expected, budget) => {
            const scriptPath = join(tmpDir, "boundary.py");
            await writeFile(scriptPath, code);
            const { stdout } = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                "--max-output-bytes",
                budget,
                scriptPath,
            ]);
            expect(stdout).toBe(expected);
        });

        it("saves complete prints alongside a complete inline dictionary", async () => {
            const scriptPath = join(tmpDir, "mixed.py");
            await writeFile(scriptPath, 'print("x" * 200)\n{"count": 42}');
            const { stdout, stderr } = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                "--max-output-bytes",
                "12",
                scriptPath,
            ]);
            expect(stdout).toContain('{"count":42}');
            expect(stderr).toBe("");
            const path = stdout.match(
                /ai_chat_output\/python-prints-[\w-]+\.txt/,
            )?.[0];
            expect(path).toBeDefined();
            expect(await readFile(join(tmpDir, path ?? ""), "utf-8")).toBe(
                `${"x".repeat(200)}\n`,
            );
        });

        it("reports the complete saved result even with a tiny inline budget", async () => {
            const scriptPath = join(tmpDir, "returned.py");
            await writeFile(
                scriptPath,
                'print("p" * 200)\n{"summary": "x" * 300, "count": 42}\n',
            );
            const { stdout, stderr } = await execFileAsync("node", [
                CLI_PATH,
                "--dir",
                tmpDir,
                "--max-output-bytes",
                "1",
                scriptPath,
            ]);
            expect(stdout).toContain("Python execution completed");
            expect(stderr).toBe("");
            const printPath = stdout.match(
                /ai_chat_output\/python-prints-[\w-]+\.txt/,
            )?.[0];
            expect(printPath).toBeDefined();
            expect(await readFile(join(tmpDir, printPath ?? ""), "utf-8")).toBe(
                `${"p".repeat(200)}\n`,
            );
            const path = stdout.match(
                /ai_chat_output\/python-result-[\w-]+\.json/,
            )?.[0];
            expect(path).toBeDefined();
            const saved = await readFile(join(tmpDir, path ?? ""), "utf-8");
            expect(JSON.parse(saved)).toEqual({
                summary: "x".repeat(300),
                count: 42,
            });
        });
    });

    // -------------------------------------------------------------------------
    // Error handling
    // -------------------------------------------------------------------------

    describe("error handling", () => {
        it("exits 1 when the script raises a Python exception", async () => {
            const scriptPath = join(tmpDir, "bad.py");
            await writeFile(scriptPath, "raise ValueError('oops')\n");

            await expect(
                execFileAsync("node", [CLI_PATH, "--dir", tmpDir, scriptPath]),
            ).rejects.toMatchObject({ code: 1 });
        });

        it("writes the error message to stderr", async () => {
            const scriptPath = join(tmpDir, "bad.py");
            await writeFile(scriptPath, "raise ValueError('oops')\n");

            let stderr = "";
            try {
                await execFileAsync("node", [
                    CLI_PATH,
                    "--dir",
                    tmpDir,
                    scriptPath,
                ]);
            } catch (err) {
                stderr = (
                    err as NodeJS.ErrnoException & {
                        /** Captured stderr from the failed process. */
                        stderr: string;
                    }
                ).stderr;
            }
            expect(stderr).toContain("oops");
        });
    });
});
