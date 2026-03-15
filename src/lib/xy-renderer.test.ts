// Unit tests for the Vega-Lite XY series renderer.
// Verifies that renderXySvg returns well-formed SVG and that labels, titles,
// kind, and options are reflected in the output. Structural details of the
// SVG (element layout, exact coordinates) are deliberately not tested —
// those are Vega's responsibility.

import { describe, expect, it } from "vitest";
import type { XYPoint } from "./stats";
import type { XYOptions } from "./xy-renderer";
import { renderXySvg } from "./xy-renderer";

// --- Fixtures ---

/** A small dataset used across most tests. */
const POINTS: XYPoint[] = [
    { x: 1, y: 10 },
    { x: 2, y: 20 },
    { x: 3, y: 15 },
];

/** A single-point dataset. */
const ONE_POINT: XYPoint[] = [{ x: 0, y: 0 }];

// --- Basic SVG structure ---

describe("renderXySvg — basic structure", () => {
    it("returns a string that starts with <svg and ends with </svg>", async () => {
        const svg = await renderXySvg(POINTS, "line");
        expect(svg.trimStart()).toMatch(/^<svg /);
        expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    });

    it("produces non-empty output", async () => {
        const svg = await renderXySvg(POINTS, "line");
        expect(svg.length).toBeGreaterThan(100);
    });

    it("produces valid SVG for a single-point dataset", async () => {
        const svg = await renderXySvg(ONE_POINT, "scatter");
        expect(svg).toContain("<svg");
        expect(svg).toContain("</svg>");
    });

    it("produces valid SVG for a larger dataset", async () => {
        const pts: XYPoint[] = Array.from({ length: 50 }, (_, i) => ({
            x: i,
            y: i * i,
        }));
        const svg = await renderXySvg(pts, "line");
        expect(svg).toContain("<svg");
    });
});

// --- Kind ---

describe("renderXySvg — kind", () => {
    it("renders line kind without throwing", async () => {
        await expect(renderXySvg(POINTS, "line")).resolves.toContain("<svg");
    });

    it("renders scatter kind without throwing", async () => {
        await expect(renderXySvg(POINTS, "scatter")).resolves.toContain("<svg");
    });

    it("produces different SVG for line vs scatter", async () => {
        const lineSvg = await renderXySvg(POINTS, "line");
        const scatterSvg = await renderXySvg(POINTS, "scatter");
        expect(lineSvg).not.toBe(scatterSvg);
    });
});

// --- Labels and title ---

describe("renderXySvg — labels and title", () => {
    it("includes the default xlabel 'x' in the SVG", async () => {
        const svg = await renderXySvg(POINTS, "line");
        expect(svg).toContain("x");
    });

    it("includes custom xlabel in the SVG", async () => {
        const svg = await renderXySvg(POINTS, "line", { xlabel: "Time (s)" });
        expect(svg).toContain("Time (s)");
    });

    it("includes custom ylabel in the SVG", async () => {
        const svg = await renderXySvg(POINTS, "line", {
            ylabel: "Amplitude",
        });
        expect(svg).toContain("Amplitude");
    });

    it("includes the title when provided", async () => {
        const svg = await renderXySvg(POINTS, "scatter", {
            title: "My Scatter",
        });
        expect(svg).toContain("My Scatter");
    });

    it("does not error when title is omitted", async () => {
        await expect(renderXySvg(POINTS, "line")).resolves.not.toThrow();
    });
});

// --- Options ---

describe("renderXySvg — options", () => {
    it("accepts xlim without throwing", async () => {
        const opts: XYOptions = { xlim: [0, 5] };
        await expect(renderXySvg(POINTS, "line", opts)).resolves.toContain(
            "<svg",
        );
    });

    it("accepts ylim without throwing", async () => {
        const opts: XYOptions = { ylim: [0, 25] };
        await expect(renderXySvg(POINTS, "scatter", opts)).resolves.toContain(
            "<svg",
        );
    });

    it("accepts ylim with a non-zero lower bound without throwing", async () => {
        const opts: XYOptions = { ylim: [5, 25] };
        await expect(renderXySvg(POINTS, "line", opts)).resolves.toContain(
            "<svg",
        );
    });

    it("accepts negative x and y values without throwing", async () => {
        const pts: XYPoint[] = [
            { x: -10, y: -5 },
            { x: 0, y: 0 },
            { x: 10, y: 5 },
        ];
        await expect(renderXySvg(pts, "scatter")).resolves.toContain("<svg");
    });
});

// --- XML special characters ---

describe("renderXySvg — special characters in labels", () => {
    it("renders without throwing when xlabel contains special characters", async () => {
        await expect(
            renderXySvg(POINTS, "line", { xlabel: "A & B < C > D" }),
        ).resolves.toContain("<svg");
    });

    it("renders without throwing when title contains special characters", async () => {
        await expect(
            renderXySvg(POINTS, "scatter", { title: 'Values "quoted"' }),
        ).resolves.toContain("<svg");
    });
});
