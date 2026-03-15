// XY series SVG renderer backed by Vega-Lite.
// Compiles a declarative Vega-Lite spec from x/y point data and renders it
// to an SVG string using Vega's server-side (no-DOM) renderer.
// No file I/O — pure data-in / SVG-string-out. Used by plot_series.

import * as vega from "vega";
import type { TopLevelSpec } from "vega-lite";
import { compile } from "vega-lite";
import type { XYPoint } from "./stats";

// --- Public types ---

/** The kind of series mark to render. */
export type SeriesKind = "line" | "scatter";

/** Options controlling the appearance of a rendered XY series plot. */
export interface XYOptions {
    /** Label for the x-axis. Defaults to "x". */
    xlabel?: string;
    /** Label for the y-axis. Defaults to "y". */
    ylabel?: string;
    /** Explicit [min, max] x-axis domain. Defaults to the data extent. */
    xlim?: [number, number];
    /** Explicit [min, max] y-axis domain. Defaults to the data extent. */
    ylim?: [number, number];
    /** Optional chart title rendered above the plot area. */
    title?: string;
}

// --- Constants ---

/** Series mark colour (dark blue, matching the histogram renderer). */
const SERIES_COLOUR = "#003366";
/** Plot area width in pixels (Vega adds its own padding for axis labels). */
const PLOT_WIDTH = 600;
/** Plot area height in pixels. */
const PLOT_HEIGHT = 370;

// --- Main export ---

/**
 * Renders an XY series as an SVG string using Vega-Lite.
 *
 * The caller supplies pre-computed x/y point data; this function builds a
 * Vega-Lite spec, compiles it to a Vega runtime spec, and renders to SVG
 * server-side (no DOM required).
 *
 * @param points - The data points to plot. Must be non-empty; validated by the caller.
 * @param kind - The mark type: "line" for a connected line, "scatter" for points only.
 * @param options - Rendering options (labels, axis limits, title).
 * @returns A promise resolving to a complete SVG string.
 */
export async function renderXySvg(
    points: XYPoint[],
    kind: SeriesKind,
    options: XYOptions = {},
): Promise<string> {
    const { xlabel = "x", ylabel = "y", title } = options;

    // Map XYPoint (camelCase) to plain row objects for Vega-Lite.
    const values = points.map((p) => ({ x: p.x, y: p.y }));

    // Vega-Lite mark type: "line" maps directly; "scatter" maps to "point".
    const markType = kind === "scatter" ? "point" : "line";

    // Build the Vega-Lite spec. Using `as TopLevelSpec` because the TypeScript
    // union is too wide to narrow precisely for the mark/encoding combination.
    const spec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        width: PLOT_WIDTH,
        height: PLOT_HEIGHT,
        background: "white",
        ...(title ? { title: { text: title } } : {}),
        data: { values },
        mark: { type: markType, color: SERIES_COLOUR },
        encoding: {
            x: {
                field: "x",
                type: "quantitative",
                title: xlabel,
                ...(options.xlim ? { scale: { domain: options.xlim } } : {}),
            },
            y: {
                field: "y",
                type: "quantitative",
                title: ylabel,
                // Default to data extent rather than forcing zero — more useful
                // for general-purpose line and scatter plots.
                scale: options.ylim
                    ? { domain: options.ylim }
                    : { zero: false },
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
