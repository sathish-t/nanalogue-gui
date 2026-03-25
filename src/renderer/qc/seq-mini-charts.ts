// Mini sparkline histograms for the QC Sequences tab.
//
// Renders three compact charts (insertion rate, deletion rate, average
// basecall quality) above the sequence table. Extracted from qc-results.ts
// to keep individual files within the line-count budget.

import { binHistogram, type HistogramBin } from "../../lib/stats";
import type { SeqTableRow } from "../../lib/types";
import { getMiniChartFontSizes } from "../shared/chart-font-size";

/**
 * Chart.js constructor declared as an ambient global.
 *
 * Provides the Chart class from the Chart.js library loaded via a script tag
 * in the HTML page.
 */
declare const Chart: {
    new (
        ctx: CanvasRenderingContext2D,
        config: Record<string, unknown>,
    ): ChartInstance;
};

/**
 * Represents an active Chart.js chart instance.
 */
interface ChartInstance {
    /** Destroys the chart instance and releases associated resources. */
    destroy(): void;
}

/**
 * Descriptor for a single mini sparkline histogram card.
 */
interface MiniChartDef {
    /** The DOM element ID of the canvas. */
    id: string;
    /** The heading text displayed above the chart. */
    title: string;
    /** The numeric values to bin. */
    values: number[];
    /** The x-axis label for the chart. */
    xLabel: string;
    /** Optional fixed minimum for the bin range. */
    fixedMin?: number;
    /** Optional fixed maximum for the bin range. */
    fixedMax?: number;
    /** Number of decimal places for bin labels. */
    labelDecimals: number;
    /** Unit suffix for the median label. */
    medianUnit: string;
}

/**
 * Per-read summary metrics extracted from sequence table rows.
 */
interface SeqMetrics {
    /** Fraction of lowercase (insertion) characters per read. */
    insertionRates: number[];
    /** Fraction of '.' (deletion) characters per read. */
    deletionRates: number[];
    /** Average basecalling quality per read (excluding missing values). */
    avgQualities: number[];
}

/** Number of bins for the mini sparkline histograms. */
const MINI_HISTOGRAM_BINS = 20;

/**
 * Computes insertion rate, deletion rate, and average quality arrays from sequence table rows.
 *
 * Insertion rate is the fraction of lowercase characters per sequence.
 * Deletion rate is the fraction of '.' characters per sequence.
 * Average quality is taken directly from each row's avgQuality field.
 *
 * @param rows - The sequence table rows to summarise.
 * @returns An object with three numeric arrays: insertionRates, deletionRates, avgQualities.
 */
export function computeSeqMetrics(rows: SeqTableRow[]): SeqMetrics {
    const insertionRates: number[] = [];
    const deletionRates: number[] = [];
    const avgQualities: number[] = [];

    for (const row of rows) {
        const len = row.sequence.length;
        if (len === 0) continue;

        let insertions = 0;
        let deletions = 0;
        for (let i = 0; i < len; i++) {
            const ch = row.sequence[i];
            if (ch === ".") {
                deletions++;
            } else if (ch >= "a" && ch <= "z") {
                insertions++;
            }
        }

        insertionRates.push(insertions / len);
        deletionRates.push(deletions / len);
        if (row.avgQuality !== null) {
            avgQualities.push(row.avgQuality);
        }
    }

    return { insertionRates, deletionRates, avgQualities };
}

/**
 * Builds histogram bins from a numeric array using a fixed number of bins.
 *
 * Delegates to {@link binHistogram} from `src/lib/stats.ts`, computing the
 * bin width from the requested number of bins and the value range.
 *
 * @param values - The values to bin.
 * @param numBins - The number of bins.
 * @param fixedMin - Optional fixed minimum for the bin range.
 * @param fixedMax - Optional fixed maximum for the bin range.
 * @returns An array of HistogramBin objects.
 */
function buildMiniHistogramBins(
    values: number[],
    numBins: number,
    fixedMin?: number,
    fixedMax?: number,
): HistogramBin[] {
    if (values.length === 0) return [];

    let min = fixedMin ?? values[0];
    let max = fixedMax ?? values[0];
    if (fixedMin === undefined || fixedMax === undefined) {
        for (const v of values) {
            if (fixedMin === undefined && v < min) min = v;
            if (fixedMax === undefined && v > max) max = v;
        }
    }

    // Avoid zero-width range
    if (max === min) max = min + 1;

    const binWidth = (max - min) / numBins;
    return binHistogram(values, binWidth, min, max);
}

/**
 * Renders a compact mini histogram chart on the specified canvas element.
 *
 * Uses minimal axis labels, no legend, and small fonts to fit a sparkline-sized card.
 *
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The histogram bin data to plot.
 * @param xLabel - The label text for the x-axis.
 * @param charts - The shared chart instance map for lifecycle management.
 * @param labelDecimals - Number of decimal places for bin labels.
 */
function renderMiniHistogram(
    canvasId: string,
    bins: HistogramBin[],
    xLabel: string,
    charts: Map<string, ChartInstance>,
    labelDecimals: number = 2,
): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    charts.get(canvasId)?.destroy();

    const labels = bins.map((b) => b.binStart.toFixed(labelDecimals));
    const data = bins.map((b) => b.count);

    // Show only a few tick labels to avoid crowding
    const maxLabels = 5;
    const skipInterval = Math.max(1, Math.ceil(bins.length / maxLabels));

    const miniFonts = getMiniChartFontSizes();

    const chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: "rgba(51, 51, 51, 0.6)",
                    borderColor: "rgba(51, 51, 51, 0.9)",
                    borderWidth: 1,
                },
            ],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: xLabel,
                        font: { size: miniFonts.title },
                        color: "#999",
                    },
                    ticks: {
                        maxRotation: 0,
                        font: { size: miniFonts.tick },
                        color: "#aaa",
                        /**
                         * Shows only every Nth label to avoid crowding.
                         *
                         * @param _value - The tick value (unused).
                         * @param index - The tick index.
                         * @returns The label string or undefined to skip.
                         */
                        callback: (
                            _value: unknown,
                            index: number,
                        ): string | undefined =>
                            index % skipInterval === 0
                                ? labels[index]
                                : undefined,
                    },
                    grid: { display: false },
                },
                y: {
                    title: { display: false },
                    beginAtZero: true,
                    ticks: {
                        font: { size: miniFonts.tick },
                        color: "#aaa",
                        maxTicksLimit: 4,
                    },
                    grid: {
                        color: "rgba(0,0,0,0.04)",
                    },
                },
            },
        },
    });

    charts.set(canvasId, chart);
}

/**
 * Computes the median of a sorted-in-place copy of the given array.
 *
 * @param values - The numeric values.
 * @returns The median value, or null if the array is empty.
 */
function medianOf(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/**
 * Renders the three mini sparkline histograms (insertion rate, deletion rate,
 * average quality) above the sequence table.
 *
 * @param containerId - The DOM element ID to insert the mini charts before.
 * @param rows - The sequence table rows.
 * @param charts - The shared chart instance map for lifecycle management.
 */
export function renderSeqMiniCharts(
    containerId: string,
    rows: SeqTableRow[],
    charts: Map<string, ChartInstance>,
): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { insertionRates, deletionRates, avgQualities } =
        computeSeqMetrics(rows);

    // Only render if we have at least some data
    if (
        insertionRates.length === 0 &&
        deletionRates.length === 0 &&
        avgQualities.length === 0
    ) {
        return;
    }

    // Build the mini charts row
    const row = document.createElement("div");
    row.className = "mini-charts-row";

    /**
     * Iterative maximum that avoids spreading large arrays.
     *
     * @param arr - The numeric values to scan.
     * @param floor - The minimum value to return.
     * @returns The larger of the array maximum and the floor.
     */
    const iterMax = (arr: number[], floor: number): number => {
        let m = floor;
        for (const v of arr) {
            if (v > m) m = v;
        }
        return m;
    };

    /** Descriptor for each mini chart to create. */
    const chartDefs: MiniChartDef[] = [
        {
            id: "mini-chart-insertions",
            title: "Insertion Rate",
            values: insertionRates,
            xLabel: "Fraction",
            fixedMin: 0,
            fixedMax: iterMax(insertionRates, 0.05),
            labelDecimals: 2,
            medianUnit: "",
        },
        {
            id: "mini-chart-deletions",
            title: "Deletion Rate",
            values: deletionRates,
            xLabel: "Fraction",
            fixedMin: 0,
            fixedMax: iterMax(deletionRates, 0.05),
            labelDecimals: 2,
            medianUnit: "",
        },
        {
            id: "mini-chart-quality",
            title: "Basecall Quality",
            values: avgQualities,
            xLabel: "Q Score",
            labelDecimals: 0,
            medianUnit: "",
        },
    ];

    for (const def of chartDefs) {
        const card = document.createElement("div");
        card.className = "mini-chart-card";

        // Mini chart heading
        const heading = document.createElement("h3");
        heading.textContent = def.title;
        card.appendChild(heading);

        // Canvas container
        const canvasContainer = document.createElement("div");
        canvasContainer.className = "mini-chart-container";

        const canvas = document.createElement("canvas");
        canvas.id = def.id;
        canvasContainer.appendChild(canvas);
        card.appendChild(canvasContainer);

        // Median label
        const median = medianOf(def.values);
        const medianDiv = document.createElement("div");
        medianDiv.className = "mini-chart-median";
        if (median !== null && def.values.length > 0) {
            const formatted =
                def.labelDecimals === 0
                    ? median.toFixed(1)
                    : median.toFixed(def.labelDecimals + 1);
            medianDiv.textContent = `Median: ${formatted}${def.medianUnit} (n=${def.values.length})`;
        } else {
            medianDiv.textContent = "No data";
        }
        card.appendChild(medianDiv);

        row.appendChild(card);
    }

    // Insert the mini charts row before the container's existing content
    container.parentElement?.insertBefore(row, container);

    // Render charts after DOM insertion so canvases have dimensions
    for (const def of chartDefs) {
        if (def.values.length === 0) continue;
        const bins = buildMiniHistogramBins(
            def.values,
            MINI_HISTOGRAM_BINS,
            def.fixedMin,
            def.fixedMax,
        );
        renderMiniHistogram(
            def.id,
            bins,
            def.xLabel,
            charts,
            def.labelDecimals,
        );
    }
}
