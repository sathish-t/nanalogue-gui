// Tests for the mini sparkline histograms rendered on the QC Sequences tab.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeqTableRow } from "../../lib/types";
import { computeSeqMetrics, renderSeqMiniCharts } from "./seq-mini-charts";

// ---------- helpers ----------

/**
 * Builds a minimal SeqTableRow for testing.
 *
 * @param sequence - The sequence string.
 * @param qualities - Per-base quality scores.
 * @param avgQuality - Average quality value (null if missing).
 * @param baseSequence - The untagged base sequence (defaults to sequence).
 * @returns A SeqTableRow object.
 */
function row(
    sequence: string,
    qualities: number[],
    avgQuality: number | null,
    baseSequence?: string,
): SeqTableRow {
    return {
        readId: "read-1",
        sequence,
        baseSequence: baseSequence ?? sequence,
        qualities,
        avgQuality,
    };
}

// ---------- computeSeqMetrics ----------

describe("computeSeqMetrics", () => {
    it("returns empty arrays for empty input", () => {
        const result = computeSeqMetrics([]);
        expect(result.insertionRates).toEqual([]);
        expect(result.deletionRates).toEqual([]);
        expect(result.avgQualities).toEqual([]);
    });

    it("skips rows with empty sequence", () => {
        const result = computeSeqMetrics([row("", [], null)]);
        expect(result.insertionRates).toEqual([]);
    });

    it("counts lowercase characters as insertions", () => {
        // 2 out of 10 characters are lowercase
        const result = computeSeqMetrics([row("ACGTacGTAC", [], null)]);
        expect(result.insertionRates).toHaveLength(1);
        expect(result.insertionRates[0]).toBeCloseTo(0.2);
    });

    it("counts dots as deletions", () => {
        // 3 out of 10 characters are dots
        const result = computeSeqMetrics([row("ACG...GTAC", [], null)]);
        expect(result.deletionRates).toHaveLength(1);
        expect(result.deletionRates[0]).toBeCloseTo(0.3);
    });

    it("collects avgQuality when not null", () => {
        const result = computeSeqMetrics([
            row("ACGT", [20, 25, 30, 22], 24.25),
            row("ACGT", [10, 10, 10, 10], 10),
        ]);
        expect(result.avgQualities).toEqual([24.25, 10]);
    });

    it("excludes null avgQuality", () => {
        const result = computeSeqMetrics([
            row("ACGT", [255, 255, 255, 255], null),
        ]);
        expect(result.avgQualities).toEqual([]);
    });

    it("handles mixed insertions, deletions, and normal bases", () => {
        // A.cG -> 1 deletion, 1 insertion out of 4
        const result = computeSeqMetrics([row("A.cG", [], null)]);
        expect(result.insertionRates[0]).toBeCloseTo(0.25);
        expect(result.deletionRates[0]).toBeCloseTo(0.25);
    });

    it("handles multiple rows", () => {
        const result = computeSeqMetrics([
            row("AAAA", [], 20),
            row("aaaa", [], 10),
            row("....", [], 5),
        ]);
        expect(result.insertionRates).toEqual([0, 1, 0]);
        expect(result.deletionRates).toEqual([0, 0, 1]);
        expect(result.avgQualities).toEqual([20, 10, 5]);
    });
});

// ---------- renderSeqMiniCharts ----------

/**
 * Mock Chart.js constructor stored on the global window object.
 */
interface MockChartInstance {
    /** Stub destroy method. */
    destroy: ReturnType<typeof vi.fn>;
}

describe("renderSeqMiniCharts", () => {
    /** Tracks all mock chart instances created during the test. */
    let mockChartInstances: MockChartInstance[];

    beforeEach(() => {
        mockChartInstances = [];

        // Mock Chart.js global — must use function (not arrow) so it is callable with new
        (globalThis as Record<string, unknown>).Chart = vi.fn(function (
            this: MockChartInstance,
        ) {
            this.destroy = vi.fn();
            mockChartInstances.push(this);
        });

        // Set up minimal DOM
        document.body.innerHTML = `
            <!-- Container parent for mini charts insertion. -->
            <div id="parent">
                <!-- Sequence table container. -->
                <div id="seq-table-container"></div>
            </div>
        `;

        // Mock canvas getContext since jsdom doesn't support it
        HTMLCanvasElement.prototype.getContext = vi.fn(
            () =>
                ({
                    canvas: document.createElement("canvas"),
                }) as unknown as CanvasRenderingContext2D,
        );
    });

    afterEach(() => {
        document.body.innerHTML = "";
        delete (globalThis as Record<string, unknown>).Chart;
        vi.restoreAllMocks();
    });

    it("does nothing when container does not exist", () => {
        const charts = new Map();
        renderSeqMiniCharts("nonexistent", [row("ACGT", [], 20)], charts);
        expect(document.querySelector(".mini-charts-row")).toBeNull();
    });

    it("does nothing when all metric arrays are empty", () => {
        const charts = new Map();
        renderSeqMiniCharts("seq-table-container", [row("", [], null)], charts);
        expect(document.querySelector(".mini-charts-row")).toBeNull();
    });

    it("renders three mini chart cards", () => {
        const charts = new Map();
        const rows = [
            row("ACGTacgt", [20, 25, 30, 22, 18, 20, 25, 30], 23.75),
            row("AC..acGT", [15, 10, 20, 25, 18, 22, 30, 28], 21.0),
        ];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        const cards = document.querySelectorAll(".mini-chart-card");
        expect(cards).toHaveLength(3);
    });

    it("creates Chart.js instances for each non-empty metric", () => {
        const charts = new Map();
        const rows = [row("ACGTacgt", [20, 25, 30, 22, 18, 20, 25, 30], 23.75)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        // 3 charts: insertion rate, deletion rate, quality
        expect(mockChartInstances).toHaveLength(3);
    });

    it("stores chart instances in the shared map", () => {
        const charts = new Map();
        const rows = [row("ACgt", [20, 25, 30, 22], 24.25)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        expect(charts.has("mini-chart-insertions")).toBe(true);
        expect(charts.has("mini-chart-deletions")).toBe(true);
        expect(charts.has("mini-chart-quality")).toBe(true);
    });

    it("displays median labels", () => {
        const charts = new Map();
        const rows = [
            row("ACGT", [20, 25, 30, 22], 20),
            row("ACGT", [10, 10, 10, 10], 30),
        ];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        const medianDivs = document.querySelectorAll(".mini-chart-median");
        expect(medianDivs).toHaveLength(3);

        // Quality median of [20, 30] = 25.0
        const qualityMedian = medianDivs[2].textContent;
        expect(qualityMedian).toContain("25.0");
        expect(qualityMedian).toContain("n=2");
    });

    it("inserts the mini charts row before the container", () => {
        const charts = new Map();
        const rows = [row("ACGT", [20, 25, 30, 22], 20)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        const parent = document.getElementById("parent");
        const miniRow = parent?.querySelector(".mini-charts-row");
        const container = document.getElementById("seq-table-container");
        expect(miniRow).not.toBeNull();
        // Mini charts row should come before the container
        expect(miniRow?.nextElementSibling).toBe(container);
    });

    it("displays chart headings", () => {
        const charts = new Map();
        const rows = [row("ACgt", [20, 25, 30, 22], 24.25)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        const headings = document.querySelectorAll(".mini-chart-card h3");
        const texts = Array.from(headings).map((h) => h.textContent);
        expect(texts).toEqual([
            "Insertion Rate",
            "Deletion Rate",
            "Basecall Quality",
        ]);
    });

    it("destroys existing chart before creating a new one", () => {
        const existingChart = { destroy: vi.fn() };
        const charts = new Map<string, MockChartInstance>([
            ["mini-chart-insertions", existingChart],
        ]);
        const rows = [row("ACgt", [20, 25, 30, 22], 24.25)];
        renderSeqMiniCharts(
            "seq-table-container",
            rows,
            charts as unknown as Map<
                string,
                { destroy(): void; resize(): void }
            >,
        );

        expect(existingChart.destroy).toHaveBeenCalled();
    });

    it("skips chart rendering when avgQuality is null for all rows", () => {
        const charts = new Map();
        // All null quality — quality chart should still attempt render
        // (insertion and deletion rates are still computed)
        const rows = [row("ACgt", [], null), row("AC..", [], null)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        // Cards still rendered for all three
        const cards = document.querySelectorAll(".mini-chart-card");
        expect(cards).toHaveLength(3);

        // But quality chart has no data, so no Chart instance for it
        expect(charts.has("mini-chart-quality")).toBe(false);

        // Quality median shows "No data"
        const medianDivs = document.querySelectorAll(".mini-chart-median");
        expect(medianDivs[2].textContent).toBe("No data");
    });

    it("handles single row with all normal bases", () => {
        const charts = new Map();
        const rows = [row("ACGT", [30, 30, 30, 30], 30)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        const cards = document.querySelectorAll(".mini-chart-card");
        expect(cards).toHaveLength(3);
    });

    it("Chart.js tick callback returns label at interval and undefined otherwise", () => {
        const charts = new Map();
        const rows = [row("ACgt", [20, 25, 30, 22], 24.25)];
        renderSeqMiniCharts("seq-table-container", rows, charts);

        // Extract the config passed to the Chart constructor
        const ChartMock = globalThis as unknown as {
            /** The mocked Chart constructor. */
            Chart: ReturnType<typeof vi.fn>;
        };
        const calls = ChartMock.Chart.mock.calls;
        expect(calls.length).toBeGreaterThan(0);

        // Get the x-axis tick callback from the first chart config
        const config = calls[0][1] as {
            /** Chart.js options. */
            options: {
                /** Scale definitions. */
                scales: {
                    /** X-axis configuration. */
                    x: {
                        /** Tick configuration. */
                        ticks: {
                            /** Tick label callback. */
                            callback: (
                                value: unknown,
                                index: number,
                            ) => string | undefined;
                        };
                    };
                };
            };
        };
        const callback = config.options.scales.x.ticks.callback;

        // Index 0 should return a label string
        const first = callback("", 0);
        expect(typeof first).toBe("string");

        // Index 1 may return undefined depending on skipInterval
        // (with 20 bins and maxLabels=5, skipInterval=4, so index 1 is skipped)
        const second = callback("", 1);
        expect(second).toBeUndefined();
    });
});
