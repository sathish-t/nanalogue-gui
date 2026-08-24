// Unit tests for shared dependency-free SVG plot layout and scaling primitives.

import { describe, expect, it } from "vitest";
import {
    findPlotValueExtent,
    renderSvgPlot,
    type SvgPlotFrameOptions,
} from "./svg-plot-primitives";

/** Complete frame options used by primitive rendering tests. */
const FRAME_OPTIONS: SvgPlotFrameOptions = {
    accessibleTitle: "Test chart",
    description: "A chart used for tests.",
    xlabel: "Horizontal",
    ylabel: "Vertical",
    xDomain: [0, 10],
    yDomain: [0, 20],
};

describe("findPlotValueExtent", () => {
    it("finds the minimum and maximum regardless of input order", () => {
        expect(findPlotValueExtent([4, -2, 9, 1])).toEqual([-2, 9]);
    });

    it("includes zero when requested", () => {
        expect(findPlotValueExtent([4, 9], true)).toEqual([0, 9]);
        expect(findPlotValueExtent([-9, -4], true)).toEqual([-9, 0]);
    });

    it("gives an all-zero extent a visible range", () => {
        expect(findPlotValueExtent([0, 0], true)).toEqual([0, 1]);
        expect(findPlotValueExtent([0, 0])).toEqual([-1, 1]);
    });

    it("pads a repeated non-zero value", () => {
        expect(findPlotValueExtent([10, 10])).toEqual([9.5, 10.5]);
    });

    it("keeps repeated extreme finite values within finite domains", () => {
        for (const value of [
            Number.MAX_VALUE,
            -Number.MAX_VALUE,
            Number.MIN_VALUE,
        ]) {
            const domain = findPlotValueExtent([value, value]);
            expect(domain.every(Number.isFinite)).toBe(true);
            expect(domain[0]).toBeLessThan(domain[1]);
        }
    });
});

describe("renderSvgPlot", () => {
    it("renders a complete accessible frame around supplied marks", () => {
        const svg = renderSvgPlot(FRAME_OPTIONS, (layout) => {
            expect(layout.plotWidth).toBe(600);
            expect(layout.plotHeight).toBe(370);
            return `      <circle cx="${layout.formatCoordinate(layout.scaleX(5))}" cy="${layout.formatCoordinate(layout.scaleY(10))}"/>`;
        });

        expect(svg).toMatch(/^<svg /);
        expect(svg).toContain('role="img"');
        expect(svg).toContain('<title id="plot-title">Test chart</title>');
        expect(svg).toContain("A chart used for tests.");
        expect(svg).toContain(">Horizontal</text>");
        expect(svg).toContain(">Vertical</text>");
        expect(svg).toContain('<circle cx="300" cy="185"/>');
        expect(svg).toMatch(/<\/svg>\n$/);
    });

    it("renders and escapes a visible title and all user-controlled text", () => {
        const svg = renderSvgPlot(
            {
                ...FRAME_OPTIONS,
                accessibleTitle: "Fallback",
                description: "A & B < C > D \"quoted\" 'single'",
                xlabel: "x < 10",
                ylabel: "A & B",
                title: "<unsafe>",
            },
            () => "",
        );

        expect(svg).toContain("&lt;unsafe&gt;");
        expect(svg).toContain("A &amp; B &lt; C &gt; D");
        expect(svg).toContain("&quot;quoted&quot;");
        expect(svg).toContain("&apos;single&apos;");
        expect(svg).not.toContain("<unsafe>");
    });

    it("uses the accessible title when the visible title is empty", () => {
        const svg = renderSvgPlot({ ...FRAME_OPTIONS, title: "" }, () => "");

        expect(svg).toContain('<title id="plot-title">Test chart</title>');
    });

    it("rounds automatic domains to readable tick boundaries", () => {
        let scaledMinimum = Number.NaN;
        renderSvgPlot(
            {
                ...FRAME_OPTIONS,
                xDomain: [1.1, 9.1],
                yDomain: [1.1, 9.1],
                niceX: true,
                niceY: true,
            },
            ({ scaleX }) => {
                scaledMinimum = scaleX(1);
                return "";
            },
        );

        expect(scaledMinimum).toBe(0);
    });

    it("uses scientific notation for very large and very small ticks", () => {
        const svg = renderSvgPlot(
            {
                ...FRAME_OPTIONS,
                xDomain: [0, 2_000_000],
                yDomain: [0, 0.0002],
            },
            () => "",
        );

        expect(svg).toContain("1.00e+6");
        expect(svg).toContain("2.00e-5");
    });

    it("renders subnormal domains without invalid ticks or coordinates", () => {
        for (const maximum of [Number.MIN_VALUE, 5e-323]) {
            const svg = renderSvgPlot(
                {
                    ...FRAME_OPTIONS,
                    xDomain: [0, maximum],
                    niceX: true,
                },
                ({ scaleX, formatCoordinate }) =>
                    `      <circle cx="${formatCoordinate(scaleX(maximum))}"/>`,
            );

            expect(svg).not.toContain("NaN");
            expect(svg).not.toContain("Infinity");
        }
    });

    it("scales finite domains whose subtraction overflows", () => {
        let midpoint = Number.NaN;
        const svg = renderSvgPlot(
            {
                ...FRAME_OPTIONS,
                xDomain: [-Number.MAX_VALUE, Number.MAX_VALUE],
                niceX: true,
            },
            ({ scaleX, formatCoordinate }) => {
                midpoint = scaleX(0);
                return `      <circle cx="${formatCoordinate(midpoint)}"/>`;
            },
        );

        expect(midpoint).toBe(300);
        expect(svg).not.toContain("NaN");
        expect(svg).not.toContain("Infinity");
    });
});
