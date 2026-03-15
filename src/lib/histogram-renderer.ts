// Histogram SVG renderer backed by Vega-Lite.
// Compiles a declarative Vega-Lite spec from pre-binned data and renders it
// to an SVG string using Vega's server-side (no-DOM) renderer.
// No file I/O — pure data-in / SVG-string-out. Used by plot_histogram.

import * as vega from "vega";
import type { TopLevelSpec } from "vega-lite";
import { compile } from "vega-lite";
import type { HistogramBin } from "./stats";

// --- Public types ---

/** Options controlling the appearance of a rendered histogram. */
export interface HistogramOptions {
    /** Label for the x-axis. Defaults to "x". */
    xlabel?: string;
    /** Label for the y-axis. Defaults to "Count". */
    ylabel?: string;
    /** Explicit [min, max] x-axis domain. Defaults to the bin data extent. */
    xlim?: [number, number];
    /** Explicit [min, max] y-axis domain. Defaults to [0, maxCount * 1.1]. */
    ylim?: [number, number];
    /** Optional chart title rendered above the plot area. */
    title?: string;
}

// --- Constants ---

/** Histogram bar fill colour (dark blue, matching the R script reference). */
const BAR_COLOUR = "#003366";
/** Plot area width in pixels (Vega adds its own padding for axis labels). */
const PLOT_WIDTH = 600;
/** Plot area height in pixels. */
const PLOT_HEIGHT = 370;

// --- Main export ---

/**
 * Renders a histogram as an SVG string using Vega-Lite.
 *
 * The caller supplies pre-binned data; this function builds a Vega-Lite spec,
 * compiles it to a Vega runtime spec, and renders to SVG server-side (no DOM
 * required). Non-uniform bin widths are handled correctly via the x/x2
 * encoding and `bin: { binned: true }`.
 *
 * @param bins - Pre-binned data. Must be non-empty; validated by the caller.
 * @param options - Rendering options (labels, axis limits, title).
 * @returns A promise resolving to a complete SVG string.
 */
export async function renderHistogramSvg(
    bins: HistogramBin[],
    options: HistogramOptions = {},
): Promise<string> {
    const { xlabel = "x", ylabel = "Count", title } = options;

    // Map HistogramBin (camelCase) to plain row objects for Vega-Lite.
    const values = bins.map((b) => ({
        bin_start: b.binStart,
        bin_end: b.binEnd,
        count: b.count,
    }));

    // Build the Vega-Lite spec. Using `as TopLevelSpec` because the
    // pre-binned encoding shape (x + x2 with bin: {binned:true}) is valid
    // per the spec but the TypeScript union is too wide to narrow precisely.
    const spec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        width: PLOT_WIDTH,
        height: PLOT_HEIGHT,
        background: "white",
        ...(title ? { title: { text: title } } : {}),
        data: { values },
        mark: { type: "bar", color: BAR_COLOUR },
        encoding: {
            x: {
                field: "bin_start",
                bin: { binned: true },
                type: "quantitative",
                title: xlabel,
                ...(options.xlim ? { scale: { domain: options.xlim } } : {}),
            },
            x2: { field: "bin_end" },
            y: {
                field: "count",
                type: "quantitative",
                title: ylabel,
                scale: options.ylim ? { domain: options.ylim } : { zero: true },
            },
        },
        config: {
            axis: { labelFontSize: 12, titleFontSize: 14 },
        },
    } as TopLevelSpec;

    const vegaSpec = compile(spec).spec;
    const view = new vega.View(vega.parse(vegaSpec), { renderer: "none" });
    try {
        return await view.toSVG();
    } finally {
        view.finalize();
    }
}
