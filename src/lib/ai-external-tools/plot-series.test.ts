// Integration tests for the makePlotSeries external tool factory.
// Calls the factory directly against a real temp directory, following the
// same pattern as the plot-histogram tests.

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
import { makePlotSeries } from "./plot-series";

/** A minimal valid points array for use across tests. */
const VALID_POINTS = [
    { x: 1, y: 10 },
    { x: 2, y: 20 },
    { x: 3, y: 15 },
];

const MAX_WRITE_BYTES = 50 * 1024 * 1024;

let allowedDir: string;
let plotSeries: (
    points: unknown,
    opts?: Record<string, unknown>,
) => Promise<unknown>;

beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "plot-series-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);
    plotSeries = makePlotSeries(allowedDir, MAX_WRITE_BYTES);
});

afterEach(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- Successful call ---

describe("makePlotSeries — successful call", () => {
    it("creates an SVG file at the specified path", async () => {
        const result = (await plotSeries(VALID_POINTS, {
            output_path: "out.svg",
        })) as Record<string, unknown>;

        expect(result.path).toBe("out.svg");
        expect(result.points_plotted).toBe(3);
        await expect(
            access(join(allowedDir, "out.svg")),
        ).resolves.toBeUndefined();
    });

    it("writes valid SVG content", async () => {
        await plotSeries(VALID_POINTS, { output_path: "chart.svg" });
        const content = await readFile(join(allowedDir, "chart.svg"), "utf-8");
        expect(content).toMatch(/^<svg /);
        expect(content).toContain("</svg>");
    });

    it("returns a note about write-only status", async () => {
        const result = (await plotSeries(VALID_POINTS, {
            output_path: "noted.svg",
        })) as Record<string, unknown>;

        expect(typeof result.note).toBe("string");
        expect(result.note as string).toContain("cannot be read");
    });

    it("auto-generates a path in AI_CHAT_OUTPUT_DIR when output_path is omitted", async () => {
        const result = (await plotSeries(VALID_POINTS)) as Record<
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
        const result = (await plotSeries(VALID_POINTS, {
            output_path: null,
        })) as Record<string, unknown>;

        expect(result.path as string).toMatch(
            new RegExp(`^${AI_CHAT_OUTPUT_DIR}/`),
        );
    });

    it("respects xlabel, ylabel, and title options", async () => {
        await plotSeries(VALID_POINTS, {
            output_path: "labelled.svg",
            xlabel: "Time (s)",
            ylabel: "Amplitude",
            title: "My Series",
        });
        const content = await readFile(
            join(allowedDir, "labelled.svg"),
            "utf-8",
        );
        expect(content).toContain("Time (s)");
        expect(content).toContain("Amplitude");
        expect(content).toContain("My Series");
    });

    it("supports nested output paths with automatic parent dir creation", async () => {
        const result = (await plotSeries(VALID_POINTS, {
            output_path: "subdir/deep/plot.svg",
        })) as Record<string, unknown>;

        expect(result.path).toBe("subdir/deep/plot.svg");
        await expect(
            access(join(allowedDir, "subdir", "deep", "plot.svg")),
        ).resolves.toBeUndefined();
    });

    it("reports points_plotted equal to the number of points supplied", async () => {
        const pts = Array.from({ length: 9 }, (_, i) => ({ x: i, y: i * 2 }));
        const result = (await plotSeries(pts, {
            output_path: "nine.svg",
        })) as Record<string, unknown>;

        expect(result.points_plotted).toBe(9);
    });

    it("defaults kind to line when kind is omitted", async () => {
        // Just verifies no error is thrown and a file is produced.
        await expect(
            plotSeries(VALID_POINTS, { output_path: "default-kind.svg" }),
        ).resolves.toMatchObject({ path: "default-kind.svg" });
    });

    it("accepts kind=scatter", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "scatter.svg",
                kind: "scatter",
            }),
        ).resolves.toMatchObject({ path: "scatter.svg" });
    });

    it("accepts kind=line explicitly", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "line.svg",
                kind: "line",
            }),
        ).resolves.toMatchObject({ path: "line.svg" });
    });
});

// --- Points validation ---

describe("makePlotSeries — points validation", () => {
    it("rejects an empty points array", async () => {
        await expect(plotSeries([])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/non-empty/),
        });
    });

    it("rejects points that is not an array", async () => {
        await expect(plotSeries("not a list")).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/non-empty/),
        });
    });

    it("rejects a point that is not a dict (e.g. a plain number)", async () => {
        await expect(plotSeries([42])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/must be a dict/),
        });
    });

    it("rejects a point missing x", async () => {
        await expect(plotSeries([{ y: 10 }])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.x must be a finite number/),
        });
    });

    it("rejects a point missing y", async () => {
        await expect(plotSeries([{ x: 1 }])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.y must be a finite number/),
        });
    });

    it("rejects a point with non-numeric x", async () => {
        await expect(plotSeries([{ x: "one", y: 10 }])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.x must be a finite number/),
        });
    });

    it("rejects a point with non-numeric y", async () => {
        await expect(plotSeries([{ x: 1, y: "ten" }])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.y must be a finite number/),
        });
    });

    it("rejects a point with Infinity for x", async () => {
        await expect(
            plotSeries([{ x: Infinity, y: 10 }]),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.x must be a finite number/),
        });
    });

    it("rejects a point with NaN for y", async () => {
        await expect(plotSeries([{ x: 1, y: NaN }])).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.y must be a finite number/),
        });
    });

    it("accepts points passed as Maps (Monty's Python dict representation)", async () => {
        const pointsAsMaps = [
            new Map([
                ["x", 0],
                ["y", 5],
            ]),
            new Map([
                ["x", 1],
                ["y", 10],
            ]),
        ];
        const result = (await plotSeries(pointsAsMaps, {
            output_path: "from-maps.svg",
        })) as Record<string, unknown>;

        expect(result.points_plotted).toBe(2);
    });

    it("accepts negative x and y values", async () => {
        const pts = [
            { x: -10, y: -5 },
            { x: 0, y: 0 },
            { x: 10, y: 5 },
        ];
        await expect(
            plotSeries(pts, { output_path: "negative.svg" }),
        ).resolves.toMatchObject({ points_plotted: 3 });
    });
});

// --- kind validation ---

describe("makePlotSeries — kind validation", () => {
    it("rejects an invalid kind string", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "bad-kind.svg",
                kind: "bar",
            }),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/kind must be "line" or "scatter"/),
        });
    });

    it("rejects a numeric kind", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "k.svg", kind: 1 }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("defaults kind to line when kind is null", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "null-kind.svg",
                kind: null,
            }),
        ).resolves.toMatchObject({ path: "null-kind.svg" });
    });
});

// --- xlim / ylim / label validation ---

describe("makePlotSeries — options validation", () => {
    it("accepts valid xlim and ylim", async () => {
        const result = (await plotSeries(VALID_POINTS, {
            output_path: "lim.svg",
            xlim: [0, 5],
            ylim: [0, 25],
        })) as Record<string, unknown>;
        expect(result.path).toBe("lim.svg");
    });

    it("rejects xlim with wrong length", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "x.svg", xlim: [0] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects xlim with non-numeric values", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "x.svg",
                xlim: ["a", "b"],
            }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects xlim where min >= max", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "x.svg", xlim: [10, 5] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects ylim where min >= max", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "x.svg", ylim: [5, 5] }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a non-string xlabel", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "x.svg", xlabel: 42 }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a non-string title", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "x.svg", title: true }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });
});

// --- Output path validation ---

describe("makePlotSeries — output path validation", () => {
    it("rejects a non-.svg extension", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "plot.png" }),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/\.svg/),
        });
    });

    it("rejects a .txt extension even with svg in the name", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "plot.svg.txt" }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("accepts a mixed-case .SVG extension", async () => {
        const result = (await plotSeries(VALID_POINTS, {
            output_path: "UPPER.SVG",
        })) as Record<string, unknown>;

        expect(result.path).toBe("UPPER.SVG");
    });

    it("rejects simple ../ traversal", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "../../escape.svg" }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects mid-path traversal (subdir/../../escape.svg)", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "subdir/../../escape.svg",
            }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects an absolute path outside allowedDir", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "/tmp/escape.svg" }),
        ).rejects.toMatchObject({ name: "OSError" });
    });

    it("rejects a symlink that points outside allowedDir", async () => {
        const outsideDir = await realpath(
            await mkdtemp(join(tmpdir(), "outside-")),
        );
        const linkPath = join(allowedDir, "escape_link");
        await symlink(outsideDir, linkPath);
        try {
            await expect(
                plotSeries(VALID_POINTS, {
                    output_path: "escape_link/plot.svg",
                }),
            ).rejects.toMatchObject({ name: "OSError" });
        } finally {
            await rm(outsideDir, { recursive: true });
        }
    });

    it("rejects a URL-style path", async () => {
        await expect(
            plotSeries(VALID_POINTS, {
                output_path: "file:///etc/passwd.svg",
            }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects overwriting an existing file", async () => {
        await writeFile(join(allowedDir, "existing.svg"), "<svg/>");
        await expect(
            plotSeries(VALID_POINTS, { output_path: "existing.svg" }),
        ).rejects.toMatchObject({ name: "FileExistsError" });
    });

    it("rejects a non-string output_path", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: 42 }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });

    it("rejects a filename component containing control characters", async () => {
        await expect(
            plotSeries(VALID_POINTS, { output_path: "file\x00name.svg" }),
        ).rejects.toMatchObject({ name: "ValueError" });
    });
});

// --- Size limit ---

describe("makePlotSeries — write size limit", () => {
    it("rejects an SVG that would exceed maxWriteBytes", async () => {
        const tinyLimit = makePlotSeries(allowedDir, 1);
        await expect(
            tinyLimit(VALID_POINTS, { output_path: "toobig.svg" }),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringMatching(/exceeds write limit/),
        });
    });
});

// --- SandboxError types ---

describe("makePlotSeries — error types", () => {
    it("throws SandboxError (not plain Error) for validation failures", async () => {
        let err: unknown;
        try {
            await plotSeries([]);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(SandboxError);
    });
});
