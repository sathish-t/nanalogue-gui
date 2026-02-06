// QC results page renderer

export {};

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
    /** Triggers a resize of the chart to fit its container. */
    resize(): void;
}

/**
 * Summary statistics computed over a set of numeric values.
 */
interface Stats {
    /** Total number of values in the dataset. */
    count: number;
    /** Sum of all values in the dataset. */
    sum: number;
    /** Minimum value in the dataset. */
    min: number;
    /** Maximum value in the dataset. */
    max: number;
    /** Arithmetic mean of the dataset. */
    mean: number;
    /** Tenth percentile value. */
    p10: number;
    /** Fiftieth percentile (median) value. */
    p50: number;
    /** Ninetieth percentile value. */
    p90: number;
    /** Standard deviation of the dataset. */
    stddev: number;
    /** N50 metric, present only for length-based statistics. */
    n50?: number;
}

/**
 * A single bin in a histogram representing a count of observations.
 */
interface HistogramBin {
    /** Inclusive lower bound of the bin range. */
    binStart: number;
    /** Exclusive upper bound of the bin range. */
    binEnd: number;
    /** Number of observations falling within this bin. */
    count: number;
}

/**
 * A single bin representing yield accumulated within a length range.
 */
interface YieldBin {
    /** Inclusive lower bound of the bin range in base pairs. */
    binStart: number;
    /** Exclusive upper bound of the bin range in base pairs. */
    binEnd: number;
    /** Total yield in bases for reads within this bin. */
    yield: number;
}

/**
 * Complete quality control data returned from the main process.
 */
interface QCData {
    /** Summary statistics for read lengths. */
    readLengthStats: Stats;
    /** Histogram bins for the read length distribution. */
    readLengthHistogram: HistogramBin[];
    /** Yield bins bucketed by read length. */
    yieldByLength: YieldBin[];
    /** The bin width used for the read length histogram. */
    readLengthBinWidth: number;
    /** The number of reads that exceeded the histogram range. */
    exceededReadLengths: number;
    /** Summary statistics for whole-read analogue density. */
    wholeReadDensityStats: Stats;
    /** Histogram bins for the whole-read density distribution. */
    wholeReadDensityHistogram: HistogramBin[];
    /** Summary statistics for windowed analogue density. */
    windowedDensityStats: Stats;
    /** Histogram bins for the windowed density distribution. */
    windowedDensityHistogram: HistogramBin[];
    /** Summary statistics for raw modification probability. */
    rawProbabilityStats: Stats;
    /** Histogram bins for the raw probability distribution. */
    rawProbabilityHistogram: HistogramBin[];
}

/**
 * API surface exposed to the QC results renderer via the preload bridge.
 */
interface QCResultsApi {
    /** Fetches the full QC dataset from the main process. */
    getQCData: () => Promise<QCData>;
    /** Navigates the user back to the configuration page. */
    goBackToConfig: () => Promise<void>;
}

/**
 * Preload-bridged API for communicating with the main process.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: QCResultsApi;
    }
).api;
const charts: Map<string, ChartInstance> = new Map();

/** Stores the full raw probability histogram bins for range filtering. */
let fullProbabilityBins: HistogramBin[] = [];

/**
 * Formats a number into a human-readable string with optional SI suffixes.
 *
 * Numbers at or above one million are displayed with an "M" suffix, numbers at
 * or above one thousand with a "K" suffix, and smaller numbers are shown with
 * the specified number of decimal places.
 *
 * @param n - The number to format.
 * @param decimals - The number of decimal places to include.
 * @returns The formatted string representation of the number.
 */
function formatNumber(n: number, decimals = 2): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(decimals)}M`;
    }
    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(decimals)}K`;
    }
    return n.toFixed(decimals);
}

/**
 * Formats a yield chart bin label adaptively based on the read length bin width.
 *
 * @param binStart - The start value of the bin.
 * @param binWidth - The bin width used for the read length histogram.
 * @returns The formatted label string.
 */
function formatYieldLabel(binStart: number, binWidth: number): string {
    if (binWidth >= 1000) {
        return formatNumber(binStart, 0);
    }
    if (binWidth >= 100) {
        if (binStart >= 1_000_000) {
            return `${(binStart / 1_000_000).toFixed(1)}M`;
        }
        if (binStart >= 1_000) {
            return `${(binStart / 1_000).toFixed(1)}K`;
        }
        return binStart.toString();
    }
    // binWidth <= 10: raw numbers with thousand separators
    return binStart.toLocaleString();
}

/**
 * Replaces a canvas element with a no-data message when there is nothing to chart.
 *
 * @param canvasId - The DOM element ID of the canvas to replace.
 * @param message - The message to display in place of the chart.
 */
function showNoData(canvasId: string, message: string): void {
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
 * Renders a summary statistics panel into the specified container element.
 *
 * Displays essential statistics (count, median, mean) by default and provides
 * an expandable section for additional percentile and deviation metrics.
 *
 * @param containerId - The DOM element ID of the container to render into.
 * @param stats - The summary statistics to display.
 * @param showN50 - Whether to include the N50 metric in the essential stats.
 */
function renderStatsPanel(
    containerId: string,
    stats: Stats,
    showN50: boolean = false,
): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const essentialStats = [
        { label: "Count", value: stats.count.toLocaleString() },
        { label: "Median", value: formatNumber(stats.p50) },
        { label: "Mean", value: formatNumber(stats.mean) },
    ];

    if (showN50 && stats.n50 !== undefined) {
        essentialStats.push({ label: "N50", value: formatNumber(stats.n50) });
    }

    const expandedStats = [
        { label: "Min", value: formatNumber(stats.min) },
        { label: "P10", value: formatNumber(stats.p10) },
        { label: "P90", value: formatNumber(stats.p90) },
        { label: "Max", value: formatNumber(stats.max) },
        { label: "Std Dev", value: formatNumber(stats.stddev) },
    ];

    container.innerHTML = `
    <div class="stats-header">
      <h3>Summary Statistics</h3>
      <button class="stats-toggle">
        Show all stats
      </button>
    </div>
    <div class="stats-grid">
      ${essentialStats
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
    <div class="stats-grid stats-expanded">
      ${expandedStats
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
  `;

    const toggleBtn = container.querySelector(".stats-toggle");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            container.classList.toggle("expanded");
            toggleBtn.textContent = toggleBtn.textContent?.includes("Show")
                ? "Hide all stats"
                : "Show all stats";
        });
    }
}

/**
 * Renders a minimal yield summary showing total yield and N50.
 *
 * @param containerId - The DOM element ID of the container to render into.
 * @param yieldBins - The yield bins bucketed by read length.
 * @param readLengthStats - The read length stats containing the N50 value.
 */
function renderYieldSummary(
    containerId: string,
    yieldBins: YieldBin[],
    readLengthStats: Stats,
): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    let totalYield = 0;
    for (const bin of yieldBins) {
        totalYield += bin.yield;
    }

    const items = [{ label: "Total Yield", value: formatNumber(totalYield) }];

    if (readLengthStats.n50 !== undefined) {
        items.push({ label: "N50", value: formatNumber(readLengthStats.n50) });
    }

    container.innerHTML = `
    <div class="stats-grid">
      ${items
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
  `;
}

/**
 * Renders a histogram bar chart on the specified canvas element.
 *
 * Destroys any existing chart on the same canvas before creating the new one.
 * The chart is rendered using Chart.js with responsive sizing disabled for
 * aspect ratio and a zero-based y-axis.
 *
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The histogram bin data to plot.
 * @param xLabel - The label text for the x-axis.
 * @param yLabel - The label text for the y-axis.
 */
function renderHistogram(
    canvasId: string,
    bins: HistogramBin[],
    xLabel: string,
    yLabel: string = "Count",
): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    charts.get(canvasId)?.destroy();

    // Auto-detect decimal places from bin width
    const binWidth = bins.length >= 2 ? bins[1].binStart - bins[0].binStart : 1;
    let labelDecimals = 0;
    if (binWidth < 0.01) {
        labelDecimals = 3;
    } else if (binWidth < 0.1) {
        labelDecimals = 2;
    } else if (binWidth < 1) {
        labelDecimals = 1;
    }

    const labels = bins.map((b) => b.binStart.toFixed(labelDecimals));
    const data = bins.map((b) => b.count);

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
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    title: { display: true, text: xLabel },
                    ticks: { maxRotation: 45 },
                },
                y: {
                    title: { display: true, text: yLabel },
                    beginAtZero: true,
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
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The yield bin data to plot.
 * @param binWidth - The bin width used for the read length histogram.
 */
function renderYieldChart(
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
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    title: { display: true, text: "Read Length (bp)" },
                    ticks: { maxRotation: 45 },
                },
                y: {
                    title: { display: true, text: "Yield (bases)" },
                    beginAtZero: true,
                },
            },
        },
    });

    charts.set(canvasId, chart);
}

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
 * Sets up the probability range filter toggle and apply button.
 */
function setupProbabilityFilter(): void {
    const toggle = document.getElementById(
        "probability-filter-toggle",
    ) as HTMLInputElement | null;
    const inputsContainer = document.getElementById(
        "probability-filter-inputs",
    );
    const lowInput = document.getElementById(
        "probability-filter-low",
    ) as HTMLInputElement | null;
    const highInput = document.getElementById(
        "probability-filter-high",
    ) as HTMLInputElement | null;
    const applyBtn = document.getElementById("probability-filter-apply");
    const errorEl = document.getElementById("probability-filter-error");

    if (
        !toggle ||
        !inputsContainer ||
        !lowInput ||
        !highInput ||
        !applyBtn ||
        !errorEl
    ) {
        return;
    }

    toggle.addEventListener("change", () => {
        if (toggle.checked) {
            inputsContainer.classList.remove("hidden");
        } else {
            inputsContainer.classList.add("hidden");
            errorEl.classList.add("hidden");
            // Restore full histogram
            renderHistogram(
                "chart-probability",
                fullProbabilityBins,
                "Modification Probability",
            );
        }
    });

    applyBtn.addEventListener("click", () => {
        const low = parseFloat(lowInput.value);
        const high = parseFloat(highInput.value);

        if (
            Number.isNaN(low) ||
            Number.isNaN(high) ||
            low < 0 ||
            high > 1 ||
            low >= high
        ) {
            errorEl.textContent =
                "Low must be less than high, both between 0 and 1.";
            errorEl.classList.remove("hidden");
            return;
        }

        errorEl.classList.add("hidden");

        // Filter bins that overlap with the requested range
        const filteredBins = fullProbabilityBins.filter((b) => {
            return b.binEnd > low && b.binStart < high;
        });

        if (filteredBins.length === 0) {
            errorEl.textContent = "No bins in the specified range.";
            errorEl.classList.remove("hidden");
            return;
        }

        renderHistogram(
            "chart-probability",
            filteredBins,
            "Modification Probability",
        );
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
            renderHistogram(
                "chart-read-lengths",
                data.readLengthHistogram,
                "Read Length (bp)",
            );
        }
        renderStatsPanel("stats-read-lengths", data.readLengthStats, true);

        // Yield tab
        if (data.yieldByLength.length === 0) {
            showNoData("chart-yield", "No yield data available.");
        } else {
            renderYieldChart(
                "chart-yield",
                data.yieldByLength,
                data.readLengthBinWidth,
            );
        }
        renderYieldSummary(
            "stats-yield",
            data.yieldByLength,
            data.readLengthStats,
        );

        // Density tab
        if (data.wholeReadDensityHistogram.length === 0) {
            showNoData(
                "chart-whole-density",
                "No modification density data available.",
            );
        } else {
            renderHistogram(
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
            renderHistogram(
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
                "chart-probability",
                data.rawProbabilityHistogram,
                "Modification Probability",
            );
        }
        renderStatsPanel("stats-probability", data.rawProbabilityStats);

        setupProbabilityFilter();
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

// Back button
document.getElementById("btn-back")?.addEventListener("click", () => {
    api.goBackToConfig();
});

initialize();
