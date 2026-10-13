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

it("makeLs supports every documented glob shape", async () => {
    await mkdir(join(allowedDir, "sample_001", "run"), { recursive: true });
    await mkdir(join(allowedDir, "run_A", "alignments", "deeper"), {
        recursive: true,
    });
    await Promise.all([
        writeFile(join(allowedDir, "sample_001", "direct.bam"), ""),
        writeFile(join(allowedDir, "sample_001", "run", "deep.bam"), ""),
        writeFile(join(allowedDir, "run_A", "alignments", "direct.bam"), ""),
        writeFile(
            join(allowedDir, "run_A", "alignments", "deeper", "deep.bam"),
            "",
        ),
    ]);
    const fn = makeLs(allowedDir, 20);

    await expect(fn("*.bam")).resolves.toEqual([bamName]);
    const sampleFiles = (await fn("sample_001/**/*.bam")) as string[];
    expect(sampleFiles).toHaveLength(2);
    expect(sampleFiles).toEqual(
        expect.arrayContaining([
            "sample_001/direct.bam",
            "sample_001/run/deep.bam",
        ]),
    );
    await expect(fn("run_A/alignments/*.bam")).resolves.toEqual([
        "run_A/alignments/direct.bam",
    ]);
    const allBamFiles = (await fn("**/*.bam")) as string[];
    expect(allBamFiles).toHaveLength(5);
    expect(allBamFiles).toEqual(
        expect.arrayContaining([
            bamName,
            "sample_001/direct.bam",
            "sample_001/run/deep.bam",
            "run_A/alignments/direct.bam",
            "run_A/alignments/deeper/deep.bam",
        ]),
    );
});

it("makeLs validates globs before traversal, including empty directories", async () => {
    const emptyDir = await mkdtemp(join(allowedDir, "empty-glob-"));
    for (const root of [emptyDir, join(emptyDir, "does-not-exist")]) {
        const fn = makeLs(root);
        for (const pattern of ["{1..1000000000}", "@(a|b)", "a".repeat(1025)]) {
            await expect(fn(pattern)).rejects.toMatchObject({
                name: "ValueError",
            });
        }
    }
    await expect(makeLs(emptyDir)("**/*.bam")).resolves.toEqual([]);
});

it("makeLs keeps hidden-file matching separate from sensitive-file exclusion", async () => {
    const root = await mkdtemp(join(allowedDir, "hidden-glob-"));
    await mkdir(join(root, ".cache"));
    for (const file of [
        "visible.bam",
        ".hidden.bam",
        ".cache/sample.bam",
        ".env",
        "private.pem",
    ]) {
        await writeFile(join(root, file), "");
    }
    const fn = makeLs(root);
    await expect(fn("**/*.bam")).resolves.toEqual(["visible.bam"]);
    await expect(fn(".cache/*.bam")).resolves.toEqual([".cache/sample.bam"]);
    await expect(fn(".*.bam")).resolves.toEqual([".hidden.bam"]);
    await expect(fn(".env")).resolves.toEqual([]);
    await expect(fn("**/*.pem")).resolves.toEqual([]);
    for (const pattern of [undefined, ""]) {
        const files = (await fn(pattern)) as string[];
        expect(files.sort()).toEqual([
            ".cache/sample.bam",
            ".hidden.bam",
            "visible.bam",
        ]);
    }
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

it("makeWriteFile atomically rejects concurrent creation of the same file", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    const contents = ["first", "second"];
    const results = await Promise.allSettled([
        fn("concurrent.txt", contents[0]),
        fn("concurrent.txt", contents[1]),
    ]);

    expect(
        results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
        results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
        results.find((result) => result.status === "rejected"),
    ).toMatchObject({
        reason: {
            name: "FileExistsError",
            message: expect.stringContaining("already exists"),
        },
    });
    const successfulIndex = results.findIndex(
        (result) => result.status === "fulfilled",
    );
    await expect(
        readFile(join(allowedDir, "concurrent.txt"), "utf-8"),
    ).resolves.toBe(contents[successfulIndex]);
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
