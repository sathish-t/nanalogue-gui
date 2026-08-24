// Dependency-free x/y series SVG renderer.
// No file I/O — pure data-in / SVG-string-out. Used by plot_series.

import type { XYPoint } from "./stats";
import { findPlotValueExtent, renderSvgPlot } from "./svg-plot-primitives";

// --- Public types ---

/** The kind of series mark to render. */
export type SeriesKind = "line" | "scatter";

/** Options controlling the appearance of a rendered XY series plot. */
export interface XYOptions {
    /** Label for the x-axis. Defaults to "x". */
    xlabel?: string;
    /** Label for the y-axis. Defaults to "y". */
    ylabel?: string;
    /** Explicit [min, max] x-axis domain. Defaults to a zero-inclusive data extent. */
    xlim?: [number, number];
    /** Explicit [min, max] y-axis domain. Defaults to the data extent. */
    ylim?: [number, number];
    /** Optional chart title rendered above the plot area. */
    title?: string;
}

/** Series mark colour (dark blue, matching the histogram renderer). */
const SERIES_COLOUR = "#003366";
/** Radius of each scatter-plot point in pixels. */
const SCATTER_POINT_RADIUS = 4;
/** Fraction of each data span reserved around automatic scatter-plot domains. */
const SCATTER_DOMAIN_PADDING = 0.05;

/**
 * Adds breathing room around scatter points at an automatic domain boundary.
 *
 * @param domain - Automatic data domain to pad on both sides.
 * @returns The domain expanded by five percent of its span on each side.
 */
function padScatterDomain(domain: [number, number]): [number, number] {
    const span = domain[1] - domain[0];
    if (!Number.isFinite(span)) return domain;
    const padding = span * SCATTER_DOMAIN_PADDING;
    const paddedMinimum = domain[0] - padding;
    const paddedMaximum = domain[1] + padding;
    return [
        Number.isFinite(paddedMinimum) ? paddedMinimum : domain[0],
        Number.isFinite(paddedMaximum) ? paddedMaximum : domain[1],
    ];
}

// --- Main export ---

/**
 * Renders an x/y series as a standalone SVG string without third-party code.
 *
 * Line points are ordered by x value. Automatic x-domains include zero,
 * automatic scatter domains include mark padding, and all marks are clipped
 * to the plot area.
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
    const automaticXDomain = findPlotValueExtent(
        points.map((point) => point.x),
        true,
    );
    const automaticYDomain = findPlotValueExtent(
        points.map((point) => point.y),
    );
    const xDomain =
        options.xlim ??
        (kind === "scatter"
            ? padScatterDomain(automaticXDomain)
            : automaticXDomain);
    const yDomain =
        options.ylim ??
        (kind === "scatter"
            ? padScatterDomain(automaticYDomain)
            : automaticYDomain);

    return renderSvgPlot(
        {
            accessibleTitle: kind === "line" ? "Line chart" : "Scatter plot",
            description: `${kind === "line" ? "Line chart" : "Scatter plot"} containing ${points.length} points.`,
            xlabel,
            ylabel,
            title,
            xDomain,
            yDomain,
            niceX: options.xlim === undefined,
            niceY: options.ylim === undefined,
        },
        ({ scaleX, scaleY, formatCoordinate }) => {
            if (kind === "scatter") {
                return points
                    .map(
                        (point) =>
                            `      <circle class="series-point" cx="${formatCoordinate(scaleX(point.x))}" cy="${formatCoordinate(scaleY(point.y))}" r="${SCATTER_POINT_RADIUS}" fill="${SERIES_COLOUR}"><title>${point.x}, ${point.y}</title></circle>`,
                    )
                    .join("\n");
            }

            const orderedPoints = [...points].sort(
                (left, right) => left.x - right.x,
            );
            const path = orderedPoints
                .map((point, index) => {
                    const command = index === 0 ? "M" : "L";
                    return `${command}${formatCoordinate(scaleX(point.x))},${formatCoordinate(scaleY(point.y))}`;
                })
                .join("");
            return `      <path class="series-line" d="${path}" fill="none" stroke="${SERIES_COLOUR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        },
    );
}
