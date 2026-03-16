// Integration tests for the ai-external-tools factory functions.
// Calls each factory directly (not through runSandboxCode) against real on-the-fly
// BAM files generated with simulateModBam, following the same pattern as
// monty-sandbox.test.ts.

import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { simulateModBam } from "@nanalogue/node";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MAX_FILENAME_LENGTH } from "../ai-chat-constants";
import { SandboxError } from "../monty-sandbox-helpers";
import { makeLs } from "./ls";
import { makeReadFile } from "./read-file";
import { makeWindowReads } from "./window-reads";
import { makeWriteFile } from "./write-file";

let allowedDir: string;
let bamName: string;

beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ai-ext-tools-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);
    const configPath = resolve(
        __dirname,
        "../../../tests/data/simulation_configs/simple_bam.json",
    );
    const config = await readFile(configPath, "utf-8");
    bamName = "simple_test.bam";
    await simulateModBam({
        jsonConfig: config,
        bamPath: join(allowedDir, bamName),
        fastaPath: join(allowedDir, "simple_test.fasta"),
    });
}, 60_000);

afterAll(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- makeWindowReads ---

it("makeWindowReads returns an array of records for a real BAM file", async () => {
    const fn = makeWindowReads(allowedDir, 1_000);
    const result = await fn(bamName, { win: 100, step: 50 });
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThan(0);
});

// --- makeLs ---

it("makeLs returns a plain array when under the cap", async () => {
    const fn = makeLs(allowedDir, 10);
    const result = await fn();
    expect(Array.isArray(result)).toBe(true);
});

it("makeLs throws SandboxError when file count exceeds maxEntries", async () => {
    // Use a small cap so we don't need to create thousands of files.
    const capDir = join(allowedDir, "cap_test");
    await mkdir(capDir, { recursive: true });
    await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
            import("node:fs/promises").then((fs) =>
                fs.writeFile(join(capDir, `f${i}.txt`), ""),
            ),
        ),
    );
    const fn = makeLs(allowedDir, 3);
    await expect(fn()).rejects.toMatchObject({
        name: "ValueError",
        message: /capped at 3 entries/,
    });
});

// --- makeWriteFile ---

it("makeWriteFile rejects a filename component longer than MAX_FILENAME_LENGTH", async () => {
    const longName = "a".repeat(MAX_FILENAME_LENGTH + 1);
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn(longName, "content")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/exceeds.*character limit/),
    });
});

it("makeWriteFile rejects a filename component containing control characters", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("file\x00name.txt", "content")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/control characters/),
    });
});

it("makeWriteFile rejects content that exceeds maxWriteBytes", async () => {
    const fn = makeWriteFile(allowedDir, 10);
    await expect(fn("big.txt", "x".repeat(100))).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/exceeds write limit/),
    });
    // Verify no file was created.
    await expect(
        import("node:fs/promises").then((fs) =>
            fs.access(join(allowedDir, "big.txt")),
        ),
    ).rejects.toThrow();
});

it("makeWriteFile throws SandboxError (not plain Error) for all guard failures", async () => {
    const fn = makeWriteFile(allowedDir, 10);
    let err: unknown;
    try {
        await fn("x".repeat(MAX_FILENAME_LENGTH + 1), "");
    } catch (e) {
        err = e;
    }
    expect(err).toBeInstanceOf(SandboxError);
});

// --- makeReadFile ---

it("makeReadFile rejects .svg files with ValueError", async () => {
    // Write a dummy SVG so the path exists; the extension check fires before
    // any filesystem access, but we want to ensure it is not bypassed for
    // existing files either.
    await writeFile(join(allowedDir, "plot.svg"), "<svg/>");
    const fn = makeReadFile(allowedDir, 1024 * 1024);
    await expect(fn("plot.svg")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/Cannot read SVG files/),
    });
});

it("makeReadFile rejects .SVG (uppercase) with ValueError", async () => {
    await writeFile(join(allowedDir, "CHART.SVG"), "<svg/>");
    const fn = makeReadFile(allowedDir, 1024 * 1024);
    await expect(fn("CHART.SVG")).rejects.toMatchObject({
        name: "ValueError",
    });
});
