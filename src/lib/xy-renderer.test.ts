// Unit tests for the dependency-free x/y series SVG renderer.
// Verifies that renderXySvg returns well-formed SVG and that labels, titles,
// kind, options, and mark geometry are reflected in the output.

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
        expect(svg).not.toContain("NaN");
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
        await expect(renderXySvg(POINTS, "line")).resolves.toContain(
            'class="series-line"',
        );
    });

    it("renders scatter kind without throwing", async () => {
        const svg = await renderXySvg(POINTS, "scatter");
        expect(svg.match(/class="series-point"/g)).toHaveLength(3);
        expect(svg).toContain('<g clip-path="url(#plot-clip)">');
    });

    it("produces different SVG for line vs scatter", async () => {
        const lineSvg = await renderXySvg(POINTS, "line");
        const scatterSvg = await renderXySvg(POINTS, "scatter");
        expect(lineSvg).not.toBe(scatterSvg);
    });

    it("orders line points by x value", async () => {
        const svg = await renderXySvg(
            [
                { x: 3, y: 15 },
                { x: 1, y: 10 },
                { x: 2, y: 20 },
            ],
            "line",
            { xlim: [1, 3], ylim: [10, 20] },
        );
        expect(svg).toContain('d="M0,370L300,0L600,185"');
    });

    it("renders extreme finite scatter domains without invalid coordinates", async () => {
        const pointSets: XYPoint[][] = [
            [
                { x: -Number.MAX_VALUE, y: -1 },
                { x: Number.MAX_VALUE, y: 1 },
            ],
            [{ x: Number.MAX_VALUE, y: Number.MAX_VALUE }],
            [{ x: -Number.MAX_VALUE, y: -Number.MAX_VALUE }],
        ];
        for (const points of pointSets) {
            const svg = await renderXySvg(points, "scatter");
            expect(svg).not.toContain("NaN");
            expect(svg).not.toContain("Infinity");
        }
    });

    it.each([
        "line",
        "scatter",
    ] as const)("includes zero in the automatic x-domain for %s plots", async (kind) => {
        const svg = await renderXySvg(
            [
                { x: 100, y: 1_000 },
                { x: 110, y: 2_000 },
            ],
            kind,
        );
        expect(svg).toContain(">0</text>");
    });
});

// --- Labels and title ---

describe("renderXySvg — labels and title", () => {
    it("includes the default xlabel 'x' in the SVG", async () => {
        const svg = await renderXySvg(POINTS, "line");
        expect(svg).toContain(">x</text>");
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
        const svg = await renderXySvg(POINTS, "line", opts);
        expect(svg).toContain('<g clip-path="url(#plot-clip)">');
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
    it("escapes special characters in axis labels", async () => {
        const svg = await renderXySvg(POINTS, "line", {
            xlabel: "A & B < C > D",
        });
        expect(svg).toContain("A &amp; B &lt; C &gt; D");
        expect(svg).not.toContain("A & B < C > D");
    });

    it("escapes special characters in titles", async () => {
        const svg = await renderXySvg(POINTS, "scatter", {
            title: '<script>"quoted"</script>',
        });
        expect(svg).toContain(
            "&lt;script&gt;&quot;quoted&quot;&lt;/script&gt;",
        );
        expect(svg).not.toContain("<script>");
    });
});
