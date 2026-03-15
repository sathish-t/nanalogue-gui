// Unit tests for the Vega-Lite histogram renderer.
// Verifies that renderHistogramSvg returns well-formed SVG and that labels,
// titles, and options are reflected in the output. Structural details of the
// SVG (element layout, exact coordinates) are deliberately not tested — those
// are Vega's responsibility.

import { describe, expect, it } from "vitest";
import type { HistogramOptions } from "./histogram-renderer";
import { renderHistogramSvg } from "./histogram-renderer";
import type { HistogramBin } from "./stats";

// --- Fixtures ---

/** Two-bin dataset used across most tests. */
const TWO_BINS: HistogramBin[] = [
    { binStart: 0, binEnd: 10, count: 5 },
    { binStart: 10, binEnd: 20, count: 3 },
];

/** Single-bin dataset. */
const ONE_BIN: HistogramBin[] = [{ binStart: 0, binEnd: 10, count: 7 }];

// --- Basic SVG structure ---

describe("renderHistogramSvg — basic structure", () => {
    it("returns a string that starts with <svg and ends with </svg>", async () => {
        const svg = await renderHistogramSvg(TWO_BINS);
        expect(svg.trimStart()).toMatch(/^<svg /);
        expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    });

    it("produces non-empty output", async () => {
        const svg = await renderHistogramSvg(TWO_BINS);
        expect(svg.length).toBeGreaterThan(100);
    });

    it("produces a valid SVG for a single-bin dataset", async () => {
        const svg = await renderHistogramSvg(ONE_BIN);
        expect(svg).toContain("<svg");
        expect(svg).toContain("</svg>");
    });

    it("produces a valid SVG for a larger dataset", async () => {
        const bins: HistogramBin[] = Array.from({ length: 20 }, (_, i) => ({
            binStart: i * 10,
            binEnd: (i + 1) * 10,
            count: i + 1,
        }));
        const svg = await renderHistogramSvg(bins);
        expect(svg).toContain("<svg");
    });
});

// --- Labels and title ---

describe("renderHistogramSvg — labels and title", () => {
    it("includes the default xlabel 'x' in the SVG", async () => {
        const svg = await renderHistogramSvg(TWO_BINS);
        expect(svg).toContain("x");
    });

    it("includes custom xlabel in the SVG", async () => {
        const svg = await renderHistogramSvg(TWO_BINS, {
            xlabel: "Read length",
        });
        expect(svg).toContain("Read length");
    });

    it("includes custom ylabel in the SVG", async () => {
        const svg = await renderHistogramSvg(TWO_BINS, {
            ylabel: "Frequency",
        });
        expect(svg).toContain("Frequency");
    });

    it("includes the title when provided", async () => {
        const svg = await renderHistogramSvg(TWO_BINS, {
            title: "My Histogram",
        });
        expect(svg).toContain("My Histogram");
    });

    it("does not error when title is omitted", async () => {
        await expect(renderHistogramSvg(TWO_BINS)).resolves.not.toThrow();
    });
});

// --- Options ---

describe("renderHistogramSvg — options", () => {
    it("accepts xlim without throwing", async () => {
        const opts: HistogramOptions = { xlim: [0, 15] };
        await expect(renderHistogramSvg(TWO_BINS, opts)).resolves.toContain(
            "<svg",
        );
    });

    it("accepts ylim without throwing", async () => {
        const opts: HistogramOptions = { ylim: [0, 10] };
        await expect(renderHistogramSvg(TWO_BINS, opts)).resolves.toContain(
            "<svg",
        );
    });

    it("accepts ylim with a non-zero lower bound without throwing", async () => {
        const opts: HistogramOptions = { ylim: [2, 10] };
        await expect(renderHistogramSvg(TWO_BINS, opts)).resolves.toContain(
            "<svg",
        );
    });

    it("handles non-uniform bin widths without throwing", async () => {
        const bins: HistogramBin[] = [
            { binStart: 0, binEnd: 5, count: 3 },
            { binStart: 5, binEnd: 15, count: 6 },
            { binStart: 15, binEnd: 100, count: 1 },
        ];
        await expect(renderHistogramSvg(bins)).resolves.toContain("<svg");
    });
});

// --- XML special characters ---

describe("renderHistogramSvg — special characters in labels", () => {
    it("renders without throwing when xlabel contains special characters", async () => {
        await expect(
            renderHistogramSvg(TWO_BINS, { xlabel: "A & B < C > D" }),
        ).resolves.toContain("<svg");
    });

    it("renders without throwing when title contains special characters", async () => {
        await expect(
            renderHistogramSvg(TWO_BINS, { title: 'Values "quoted"' }),
        ).resolves.toContain("<svg");
    });
});
