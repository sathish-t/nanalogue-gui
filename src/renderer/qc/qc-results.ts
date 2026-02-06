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
      <button class="stats-toggle" onclick="this.parentElement.parentElement.classList.toggle('expanded'); this.textContent = this.textContent.includes('Show') ? 'Hide all stats' : 'Show all stats';">
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

    const labels = bins.map((b) => `${formatNumber(b.binStart, 0)}`);
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
 * same canvas before creating the new one.
 *
 * @param canvasId - The DOM element ID of the target canvas.
 * @param bins - The yield bin data to plot.
 */
function renderYieldChart(canvasId: string, bins: YieldBin[]): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    charts.get(canvasId)?.destroy();

    const labels = bins.map((b) => `${formatNumber(b.binStart, 0)}`);
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
 * Loads QC data from the main process and renders all charts and statistics.
 *
 * Populates charts and stats panels across all tabs including read lengths,
 * yield, analogue density, and modification probability. Called once when the
 * page loads.
 */
async function initialize(): Promise<void> {
    const data = await api.getQCData();

    // Read lengths tab
    renderHistogram(
        "chart-read-lengths",
        data.readLengthHistogram,
        "Read Length (bp)",
    );
    renderStatsPanel("stats-read-lengths", data.readLengthStats, true);

    // Yield tab
    renderYieldChart("chart-yield", data.yieldByLength);
    renderStatsPanel("stats-yield", data.readLengthStats, true);

    // Density tab
    renderHistogram(
        "chart-whole-density",
        data.wholeReadDensityHistogram,
        "Analogue Density",
    );
    renderStatsPanel("stats-whole-density", data.wholeReadDensityStats);

    renderHistogram(
        "chart-windowed-density",
        data.windowedDensityHistogram,
        "Windowed Density",
    );
    renderStatsPanel("stats-windowed-density", data.windowedDensityStats);

    // Probability tab
    renderHistogram(
        "chart-probability",
        data.rawProbabilityHistogram,
        "Modification Probability",
    );
    renderStatsPanel("stats-probability", data.rawProbabilityStats);

    setupTabs();
}

// Back button
document.getElementById("btn-back")?.addEventListener("click", () => {
    api.goBackToConfig();
});

initialize();
