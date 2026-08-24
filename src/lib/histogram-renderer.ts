// Dependency-free histogram SVG renderer.
// No file I/O — pure data-in / SVG-string-out. Used by plot_histogram.

import type { HistogramBin } from "./stats";
import { findPlotValueExtent, renderSvgPlot } from "./svg-plot-primitives";

// --- Public types ---

/** Options controlling the appearance of a rendered histogram. */
export interface HistogramOptions {
    /** Label for the x-axis. Defaults to "x". */
    xlabel?: string;
    /** Label for the y-axis. Defaults to "Count". */
    ylabel?: string;
    /** Explicit [min, max] x-axis domain. Defaults to the bin data extent. */
    xlim?: [number, number];
    /** Explicit [min, max] y-axis domain. Defaults to a zero-based count domain. */
    ylim?: [number, number];
    /** Optional chart title rendered above the plot area. */
    title?: string;
}

/** Histogram bar fill colour (dark blue, matching the R script reference). */
const BAR_COLOUR = "#003366";

// --- Main export ---

/**
 * Renders a histogram as a standalone SVG string without third-party code.
 *
 * The caller supplies pre-binned data. Non-uniform bin widths are mapped
 * directly onto a linear x-axis and marks are clipped to explicit limits.
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
    const xDomain =
        options.xlim ??
        findPlotValueExtent(bins.flatMap((bin) => [bin.binStart, bin.binEnd]));
    const yDomain =
        options.ylim ??
        findPlotValueExtent(
            bins.map((bin) => bin.count),
            true,
        );

    return renderSvgPlot(
        {
            accessibleTitle: "Histogram",
            description: `Histogram containing ${bins.length} bins.`,
            xlabel,
            ylabel,
            title,
            xDomain,
            yDomain,
            niceX: options.xlim === undefined,
            niceY: options.ylim === undefined,
        },
        ({ scaleX, scaleY, formatCoordinate }) =>
            bins
                .map((bin) => {
                    const scaledStart = scaleX(bin.binStart);
                    const scaledEnd = scaleX(bin.binEnd);
                    const scaledCount = scaleY(bin.count);
                    const scaledZero = scaleY(0);
                    const x = Math.min(scaledStart, scaledEnd);
                    const y = Math.min(scaledCount, scaledZero);
                    const width = Math.abs(scaledEnd - scaledStart);
                    const height = Math.abs(scaledZero - scaledCount);
                    return `      <rect class="histogram-bar" x="${formatCoordinate(x)}" y="${formatCoordinate(y)}" width="${formatCoordinate(width)}" height="${formatCoordinate(height)}" fill="${BAR_COLOUR}"><title>${bin.binStart}–${bin.binEnd}: ${bin.count}</title></rect>`;
                })
                .join("\n"),
    );
}
