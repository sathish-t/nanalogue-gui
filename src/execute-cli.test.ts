// Tests for the nanalogue-sandbox-exec CLI entry point.
// Spawns the built binary and verifies flag handling, validation, and
// basic script execution. Requires `npm run build` to have run first.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version } from "../package.json";

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
            ).rejects.toMatchObject({ code: 1 });
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

        it("truncates output when --max-output-bytes is exceeded", async () => {
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

            expect(stdout).toContain("[output truncated");
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
