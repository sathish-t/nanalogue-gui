import {
    formatYieldLabel,
    trimZeroHistogramBins,
    trimZeroYieldBins,
} from "../../lib/format-utils";
import type { HistogramBin } from "../../lib/stats";
import {
    renderHistogram,
    renderYieldChart,
    showNoData,
} from "./qc-results-charts";
import { setupHistogramFilter } from "./qc-results-filters";
import { renderSeqTable } from "./qc-results-seq-table";
import { renderStatsPanel, renderYieldSummary } from "./qc-results-stats";
import type { ChartInstance, QCResultsApi } from "./qc-results-types";
import { renderSeqMiniCharts } from "./seq-mini-charts";

/**
 * Preload-bridged API for communicating with the main process.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: QCResultsApi;
    }
).api;

/** Stores active chart instances keyed by canvas ID. */
const charts: Map<string, ChartInstance> = new Map();

/** Stores the full raw probability histogram bins for range filtering. */
let fullProbabilityBins: HistogramBin[] = [];

/** Stores the full whole-read density histogram bins for range filtering. */
let fullWholeReadDensityBins: HistogramBin[] = [];

/** Stores the full windowed density histogram bins for range filtering. */
let fullWindowedDensityBins: HistogramBin[] = [];

/**
 * Initializes the tab navigation system for the QC results page.
 *
 * Attaches click handlers to all tab buttons that toggle the active state on
 * both buttons and content panels, and triggers a resize on all active charts
 * so they render correctly when their tab becomes visible.
 */
function setupTabs(): void {
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const tabId = button.getAttribute("data-tab");

            tabButtons.forEach((b) => {
                b.classList.remove("active");
            });
            tabContents.forEach((c) => {
                c.classList.remove("active");
            });

            button.classList.add("active");
            document.getElementById(`tab-${tabId}`)?.classList.add("active");

            // Trigger chart resize
            charts.forEach((chart) => {
                chart.resize();
            });
        });
    });
}

/**
 * Loads QC data from the main process and renders all charts and statistics.
 *
 * Populates charts and stats panels across all tabs including read lengths,
 * yield, analogue density, and modification probability. Called once when the
 * page loads.
 */
async function initialize(): Promise<void> {
    try {
        const data = await api.getQCData();

        if (!data) {
            showErrorState(
                "No QC data available",
                "Run a QC analysis from the configuration page first.",
            );
            return;
        }

        const seedDisplay = document.getElementById("sample-seed-display");
        if (seedDisplay) {
            seedDisplay.textContent = `Sample seed: ${data.sampleSeed} `;
            const hint = document.createElement("span");
            hint.style.color = "#bbb";
            hint.style.fontSize = "0.786rem";
            hint.textContent = "(only used if subsampling)";
            seedDisplay.appendChild(hint);
        }

        // Show warning if reads exceeded the histogram range
        if (data.exceededReadLengths > 0) {
            const warningDiv = document.createElement("div");
            warningDiv.className = "exceeded-warning";
            warningDiv.textContent = `${data.exceededReadLengths} read(s) exceeded the histogram range. Consider using a coarser resolution setting.`;
            const readLengthsTab = document.getElementById("tab-read-lengths");
            if (readLengthsTab) {
                readLengthsTab.insertBefore(
                    warningDiv,
                    readLengthsTab.firstChild,
                );
            }
        }

        // Read lengths tab
        if (data.readLengthHistogram.length === 0) {
            showNoData("chart-read-lengths", "No read length data available.");
        } else {
            const binWidth = data.readLengthBinWidth;
            renderHistogram(
                charts,
                "chart-read-lengths",
                trimZeroHistogramBins(data.readLengthHistogram),
                "Read Length (bp)",
                "Count",
                (binStart) => formatYieldLabel(binStart, binWidth),
            );
        }
        renderStatsPanel(
            "stats-read-lengths",
            data.readLengthStats,
            true,
            "Lengths shown are alignment lengths, not basecalled read lengths.",
            data.readTypeCounts,
        );

        // Yield tab
        if (data.yieldByLength.length === 0) {
            showNoData("chart-yield", "No yield data available.");
        } else {
            renderYieldChart(
                charts,
                "chart-yield",
                trimZeroYieldBins(data.yieldByLength),
                data.readLengthBinWidth,
            );
        }
        renderYieldSummary(
            "stats-yield",
            data.yieldByLength,
            data.readLengthStats,
            "Data in view based on alignment length, not basecalled read lengths.",
        );

        // Density tab
        fullWholeReadDensityBins = data.wholeReadDensityHistogram;
        if (data.wholeReadDensityHistogram.length === 0) {
            showNoData(
                "chart-whole-density",
                "No modification density data available.",
            );
        } else {
            renderHistogram(
                charts,
                "chart-whole-density",
                data.wholeReadDensityHistogram,
                "Analogue Density",
            );
        }
        renderStatsPanel("stats-whole-density", data.wholeReadDensityStats);

        if (
            !data.windowedDensityStats ||
            data.windowedDensityStats.count === 0
        ) {
            fullWindowedDensityBins = [];
            showNoData(
                "chart-windowed-density",
                "No windowed density data available for the selected parameters.",
            );
            const statsContainer = document.getElementById(
                "stats-windowed-density",
            );
            if (statsContainer) {
                statsContainer.textContent = "";
            }
        } else {
            fullWindowedDensityBins = data.windowedDensityHistogram;
            renderHistogram(
                charts,
                "chart-windowed-density",
                data.windowedDensityHistogram,
                "Windowed Density",
            );
            renderStatsPanel(
                "stats-windowed-density",
                data.windowedDensityStats,
            );
        }

        // Probability tab
        fullProbabilityBins = data.rawProbabilityHistogram;
        if (data.rawProbabilityHistogram.length === 0) {
            showNoData(
                "chart-probability",
                "No modification probability data available.",
            );
        } else {
            renderHistogram(
                charts,
                "chart-probability",
                data.rawProbabilityHistogram,
                "Modification Probability",
            );
        }
        renderStatsPanel("stats-probability", data.rawProbabilityStats);

        setupHistogramFilter(
            charts,
            "probability-filter",
            () => fullProbabilityBins,
            "chart-probability",
            "Modification Probability",
            "stats-probability",
        );
        setupHistogramFilter(
            charts,
            "whole-density-filter",
            () => fullWholeReadDensityBins,
            "chart-whole-density",
            "Analogue Density",
            "stats-whole-density",
        );
        setupHistogramFilter(
            charts,
            "windowed-density-filter",
            () => fullWindowedDensityBins,
            "chart-windowed-density",
            "Windowed Density",
            "stats-windowed-density",
        );

        // Sequences tab
        renderSeqTable(
            "seq-table-container",
            data.seqTableRows,
            data.seqTableSkipReason,
            data.seqTableAmbiguousReadIds,
        );

        // Mini sparkline histograms for insertion rate, deletion rate, and quality
        if (data.seqTableRows && data.seqTableRows.length > 0) {
            renderSeqMiniCharts(
                "seq-table-container",
                data.seqTableRows,
                charts,
            );
        }

        setupTabs();
    } catch (error) {
        console.error("Failed to initialize QC results:", error);
        showErrorState("Failed to load QC results", String(error));
    }
}

/**
 * Renders an error or empty state on the page with a back-to-config button.
 *
 * @param title - The heading text for the error state.
 * @param message - The descriptive message shown below the heading.
 */
function showErrorState(title: string, message: string): void {
    const main = document.querySelector("main");
    if (!main) return;

    main.textContent = "";

    const wrapper = document.createElement("div");
    wrapper.className = "no-data-message";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.padding = "2rem";
    wrapper.style.gap = "1rem";

    const h2 = document.createElement("h2");
    h2.textContent = title;

    const p = document.createElement("p");
    p.textContent = message;

    const btn = document.createElement("button");
    btn.className = "primary-button";
    btn.textContent = "Back to config";
    btn.addEventListener("click", () => api.goBackToConfig());

    wrapper.append(h2, p, btn);
    main.appendChild(wrapper);
}

/**
 * Wires up the QC results page and starts initial rendering.
 */
export function initializeQCResultsPage(): void {
    document.getElementById("btn-back")?.addEventListener("click", () => {
        api.goBackToConfig();
    });

    void initialize();
}
