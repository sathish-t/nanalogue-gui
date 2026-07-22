import { formatYieldLabel } from "../../lib/format-utils";
import type { HistogramBin, YieldBin } from "../../lib/stats";
import { getChartFontSizes } from "../shared/chart-font-size";
import type { ChartInstance } from "./qc-results-types";

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
 * Replaces a canvas element with a no-data message when there is nothing to chart.
 *
 * @param canvasId - The DOM element ID of the canvas to replace.
 * @param message - The message to display in place of the chart.
 */
export function showNoData(canvasId: string, message: string): void {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const noDataDiv = document.createElement("div");
    noDataDiv.className = "no-data-message";
    noDataDiv.textContent = message;
    container.replaceChild(noDataDiv, canvas);
}

/**
 * Renders a histogram bar chart on the specified canvas element.
 *
 * Destroys any existing chart on the same canvas before creating the new one.
 * The chart is rendered using Chart.js with responsive sizing disabled for
 * aspect ratio and a zero-based y-axis.
 *
 * @param charts - Registry of active charts keyed by canvas ID.
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The histogram bin data to plot.
 * @param xLabel - The label text for the x-axis.
 * @param yLabel - The label text for the y-axis.
 * @param formatLabel - Optional custom formatter for bin labels.
 */
export function renderHistogram(
    charts: Map<string, ChartInstance>,
    canvasId: string,
    bins: HistogramBin[],
    xLabel: string,
    yLabel: string = "Count",
    formatLabel?: (binStart: number) => string,
): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    charts.get(canvasId)?.destroy();

    // Auto-detect decimal places from bin width
    const binWidth =
        bins.length >= 2
            ? bins[1].binStart - bins[0].binStart
            : bins[0].binEnd - bins[0].binStart;
    let labelDecimals = 0;
    if (binWidth < 0.01) {
        labelDecimals = 3;
    } else if (binWidth < 0.1) {
        labelDecimals = 2;
    } else if (binWidth < 1) {
        labelDecimals = 1;
    }

    const labels = formatLabel
        ? bins.map((b) => formatLabel(b.binStart))
        : bins.map((b) => b.binStart.toFixed(labelDecimals));
    const data = bins.map((b) => b.count);

    const fontSizes = getChartFontSizes();

    const chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: "rgba(51, 51, 51, 0.7)",
                    borderColor: "rgba(51, 51, 51, 1)",
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
                        font: { size: fontSizes.title },
                    },
                    ticks: {
                        maxRotation: 45,
                        font: { size: fontSizes.tick },
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: yLabel,
                        font: { size: fontSizes.title },
                    },
                    beginAtZero: true,
                    ticks: { font: { size: fontSizes.tick } },
                },
            },
        },
    });

    charts.set(canvasId, chart);
}

/**
 * Renders a yield bar chart on the specified canvas element.
 *
 * Plots yield in bases per read-length bin. Destroys any existing chart on the
 * same canvas before creating the new one. Label formatting adapts to the bin width.
 *
 * @param charts - Registry of active charts keyed by canvas ID.
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The yield bin data to plot.
 * @param binWidth - The bin width used for the read length histogram.
 */
export function renderYieldChart(
    charts: Map<string, ChartInstance>,
    canvasId: string,
    bins: YieldBin[],
    binWidth: number,
): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    charts.get(canvasId)?.destroy();

    const labels = bins.map((b) => formatYieldLabel(b.binStart, binWidth));
    const data = bins.map((b) => b.yield);

    const fontSizes = getChartFontSizes();

    const chart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: "rgba(51, 51, 51, 0.7)",
                    borderColor: "rgba(51, 51, 51, 1)",
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
                        text: "Read Length (bp)",
                        font: { size: fontSizes.title },
                    },
                    ticks: {
                        maxRotation: 45,
                        font: { size: fontSizes.tick },
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: "Yield (bases)",
                        font: { size: fontSizes.title },
                    },
                    beginAtZero: true,
                    ticks: { font: { size: fontSizes.tick } },
                },
            },
        },
    });

    charts.set(canvasId, chart);
}
