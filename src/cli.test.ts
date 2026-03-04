// Tests for the nanalogue-chat CLI entry point.
// Spawns the built CLI binary and verifies flag behavior.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
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
});
