// Integration tests for the makePlotHistogram external tool factory.
// Calls the factory directly against a real temp directory, following the
// same pattern as the other ai-external-tools tests.

import {
    access,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_CHAT_OUTPUT_DIR } from "../ai-chat-constants";
import { SandboxError } from "../monty-sandbox-helpers";
import { makePlotHistogram } from "./plot-histogram";

/** A minimal valid bins array for use across tests. */
const VALID_BINS = [
    { bin_start: 0, bin_end: 10, count: 5 },
    { bin_start: 10, bin_end: 20, count: 3 },
];

const MAX_WRITE_BYTES = 50 * 1024 * 1024;

let allowedDir: string;
let plotHistogram: (
    bins: unknown,
    opts?: Record<string, unknown>,
) => Promise<unknown>;

beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "plot-histogram-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);
    plotHistogram = makePlotHistogram(allowedDir, MAX_WRITE_BYTES);
});

afterEach(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- Successful call ---

describe("makePlotHistogram — successful call", () => {
    it("creates an SVG file at the specified path", async () => {
        const result = (await plotHistogram(VALID_BINS, {
            output_path: "out.svg",
        })) as Record<string, unknown>;

        expect(result.path).toBe("out.svg");
        expect(result.bins_plotted).toBe(2);
        await expect(
            access(join(allowedDir, "out.svg")),
        ).resolves.toBeUndefined();
    });

    it("writes valid SVG content", async () => {
        await plotHistogram(VALID_BINS, { output_path: "chart.svg" });
        const content = await readFile(join(allowedDir, "chart.svg"), "utf-8");
        expect(content).toMatch(/^<svg /);
        expect(content).toContain("</svg>");
    });

    it("returns a note about write-only status", async () => {
        const result = (await plotHistogram(VALID_BINS, {
            output_path: "noted.svg",
        })) as Record<string, unknown>;

        expect(typeof result.note).toBe("string");
        expect(result.note as string).toContain("cannot be read");
    });

    it("auto-generates a path in AI_CHAT_OUTPUT_DIR when output_path is omitted", async () => {
        const result = (await plotHistogram(VALID_BINS)) as Record<
            string,
            unknown
        >;

        expect(typeof result.path).toBe("string");
        expect(result.path as string).toMatch(
            new RegExp(
                `^${AI_CHAT_OUTPUT_DIR}/nanalogue-plot-\\d{4}-\\d{2}-\\d{2}-`,
            ),
        );
        expect(result.path as string).toMatch(/\.svg$/);
        await expect(
            access(join(allowedDir, result.path as string)),
        ).resolves.toBeUndefined();
    });

    it("auto-generates a path when output_path is explicitly null", async () => {
        const result = (await plotHistogram(VALID_BINS, {
            output_path: null,
        })) as Record<string, unknown>;

        expect(result.path as string).toMatch(
            new RegExp(`^${AI_CHAT_OUTPUT_DIR}/`),
        );
    });

    it("respects xlabel, ylabel, and title options", async () => {
        await plotHistogram(VALID_BINS, {
            output_path: "labelled.svg",
            xlabel: "Read length",
            ylabel: "Frequency",
            title: "My Histogram",
        });
        const content = await readFile(
            join(allowedDir, "labelled.svg"),
            "utf-8",
        );
        expect(content).toContain("Read length");
        expect(content).toContain("Frequency");
        expect(content).toContain("My Histogram");
    });

    it("supports nested output paths with automatic parent dir creation", async () => {
        const result = (await plotHistogram(VALID_BINS, {
            output_path: "subdir/deep/plot.svg",
        })) as Record<string, unknown>;

        expect(result.path).toBe("subdir/deep/plot.svg");
        await expect(
            access(join(allowedDir, "subdir", "deep", "plot.svg")),
        ).resolves.toBeUndefined();
    });

    it("reports bins_plotted equal to the number of bins supplied", async () => {
        const bins = Array.from({ length: 7 }, (_, i) => ({
            bin_start: i * 10,
            bin_end: (i + 1) * 10,
            count: i,
        }));
        const result = (await plotHistogram(bins, {
            output_path: "seven.svg",
        })) as Record<string, unknown>;

        expect(result.bins_plotted).toBe(7);
    });
});

// --- Bins validation ---

describe("makePlotHistogram — bins validation", () => {
    it("rejects an empty bins array", async () => {
        await expect(plotHistogram([])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/non-empty/),
        });
    });

    it("rejects bins that is not an array", async () => {
        await expect(plotHistogram("not a list")).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/non-empty/),
        });
    });

    it("rejects a bin that is not a dict (e.g. a plain number)", async () => {
        await expect(plotHistogram([42])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/must be a dict/),
        });
    });

    it("rejects a bin missing bin_start", async () => {
        await expect(
            plotHistogram([{ bin_end: 10, count: 1 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/bin_start/),
        });
    });

    it("rejects a bin with non-numeric bin_end", async () => {
        await expect(
            plotHistogram([{ bin_start: 0, bin_end: "ten", count: 1 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/bin_end/),
        });
    });

    it("rejects a bin where bin_end <= bin_start", async () => {
        await expect(
            plotHistogram([{ bin_start: 10, bin_end: 5, count: 1 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/greater than bin_start/),
        });
    });

    it("rejects a bin where bin_end equals bin_start", async () => {
        await expect(
            plotHistogram([{ bin_start: 5, bin_end: 5, count: 1 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
        });
    });

    it("rejects a bin with negative count", async () => {
        await expect(
            plotHistogram([{ bin_start: 0, bin_end: 10, count: -1 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/count.*>= 0/),
        });
    });

    it("rejects a bin with non-numeric count", async () => {
        await expect(
            plotHistogram([{ bin_start: 0, bin_end: 10, count: "five" }]),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("accepts bins passed as Maps (Monty's Python dict representation)", async () => {
        // Monty passes Python dicts as JS Maps; the tool must handle this.
        const binsAsMaps = [
            new Map([
                ["bin_start", 0],
                ["bin_end", 10],
                ["count", 4],
            ]),
        ];
        const result = (await plotHistogram(binsAsMaps, {
            output_path: "from-maps.svg",
        })) as Record<string, unknown>;

        expect(result.bins_plotted).toBe(1);
    });
});

// --- xlim / ylim / label validation ---

describe("makePlotHistogram — options validation", () => {
    it("accepts valid xlim and ylim", async () => {
        const result = (await plotHistogram(VALID_BINS, {
            output_path: "lim.svg",
            xlim: [0, 20],
            ylim: [0, 10],
        })) as Record<string, unknown>;
        expect(result.path).toBe("lim.svg");
    });

    it("rejects xlim with wrong length", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "x.svg", xlim: [0] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects xlim with non-numeric values", async () => {
        await expect(
            plotHistogram(VALID_BINS, {
                output_path: "x.svg",
                xlim: ["a", "b"],
            }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects xlim where min >= max", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "x.svg", xlim: [10, 5] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects ylim where min >= max", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "x.svg", ylim: [5, 5] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a non-string xlabel", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "x.svg", xlabel: 42 }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a non-string title", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "x.svg", title: true }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });
});

// --- Output path validation ---

describe("makePlotHistogram — output path validation", () => {
    it("rejects a non-.svg extension", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "plot.png" }),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.svg/),
        });
    });

    it("rejects a .txt extension even with svg in the name", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "plot.svg.txt" }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("accepts a mixed-case .SVG extension", async () => {
        // The plan says case-insensitive enforcement.
        const result = (await plotHistogram(VALID_BINS, {
            output_path: "UPPER.SVG",
        })) as Record<string, unknown>;

        expect(result.path).toBe("UPPER.SVG");
    });

    it("rejects simple ../ traversal", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "../../escape.svg" }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects mid-path traversal (subdir/../../escape.svg)", async () => {
        await expect(
            plotHistogram(VALID_BINS, {
                output_path: "subdir/../../escape.svg",
            }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects an absolute path outside allowedDir", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "/tmp/escape.svg" }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects a symlink that points outside allowedDir", async () => {
        // Create a directory outside allowedDir and a symlink to it inside.
        const outsideDir = await realpath(
            await mkdtemp(join(tmpdir(), "outside-")),
        );
        const linkPath = join(allowedDir, "escape_link");
        await symlink(outsideDir, linkPath);
        try {
            await expect(
                plotHistogram(VALID_BINS, {
                    output_path: "escape_link/plot.svg",
                }),
            ).rejects.toMatchObject({ name: "OSError" });
        } finally {
            await rm(outsideDir, { recursive: true });
        }
    });

    it("rejects a URL-style path", async () => {
        await expect(
            plotHistogram(VALID_BINS, {
                output_path: "file:///etc/passwd.svg",
            }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects overwriting an existing file", async () => {
        await writeFile(join(allowedDir, "existing.svg"), "<svg/>");
        await expect(
            plotHistogram(VALID_BINS, { output_path: "existing.svg" }),
        ).rejects.toMatchObject({ name: "FileExistsError" });
    });

    it("rejects a non-string output_path", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: 42 }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a filename component containing control characters", async () => {
        await expect(
            plotHistogram(VALID_BINS, { output_path: "file\x00name.svg" }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });
});

// --- Size limit ---

describe("makePlotHistogram — write size limit", () => {
    it("rejects an SVG that would exceed maxWriteBytes", async () => {
        // Use a tiny limit so even a small SVG exceeds it.
        const tinyLimit = makePlotHistogram(allowedDir, 1);
        await expect(
            tinyLimit(VALID_BINS, { output_path: "toobig.svg" }),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/exceeds write limit/),
        });
    });
});

// --- SandboxError types ---

describe("makePlotHistogram — error types", () => {
    it("throws SandboxError (not plain Error) for validation failures", async () => {
        let err: unknown;
        try {
            await plotHistogram([]);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(SandboxError);
    });
});
