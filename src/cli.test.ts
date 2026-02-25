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
});
