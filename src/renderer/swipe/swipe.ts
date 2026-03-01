// Renderer script for nanalogue-swipe

export {};

/**
 * External Chart.js constructor available on the global window object.
 */
declare const Chart: {
    new (
        ctx: CanvasRenderingContext2D,
        config: Record<string, unknown>,
    ): ChartInstance;
};

/**
 * Represents a Chart.js chart instance with lifecycle methods.
 */
interface ChartInstance {
    /** Destroys the chart instance and releases associated resources. */
    destroy(): void;
}

/**
 * Defines the IPC API surface exposed to the renderer for swipe actions and state queries.
 */
interface SwipeApi {
    /** Retrieves the current application state from the main process. */
    getState: () => Promise<AppState>;

    /** Retrieves the plot data for the current annotation from the main process. */
    getPlotData: () => Promise<PlotData | null>;

    /** Sends an accept action for the current annotation to the main process. */
    accept: () => Promise<ActionResult>;

    /** Sends a reject action for the current annotation to the main process. */
    reject: () => Promise<ActionResult>;
}

/**
 * Represents the overall application state including progress and decision counts.
 */
interface AppState {
    /** The zero-based index of the current annotation being reviewed. */
    currentIndex: number;

    /** The total number of annotations available for review. */
    totalCount: number;

    /** The number of annotations that have been accepted so far. */
    acceptedCount: number;

    /** The number of annotations that have been rejected so far. */
    rejectedCount: number;

    /** The file path where accepted annotations are being written. */
    outputPath?: string;

    /** Whether to show the annotation region highlight box on the chart. */
    showAnnotationHighlight?: boolean;
}

/**
 * Represents a single raw data point with genomic position and modification probability.
 */
interface PlotDataPoint {
    /** The genomic position in base pairs. */
    x: number;

    /** The modification probability value between zero and one. */
    y: number;
}

/**
 * Represents a windowed aggregation point over a genomic region.
 */
interface WindowedPoint {
    /** The start position of the reference window in base pairs. */
    refWinStart: number;

    /** The end position of the reference window in base pairs. */
    refWinEnd: number;

    /** The aggregated modification value for this window. */
    winVal: number;
}

/**
 * Contains all data needed to render a modification probability plot for one annotation.
 */
interface PlotData {
    /** The array of raw per-position modification probability points. */
    rawPoints: PlotDataPoint[];

    /** The array of windowed aggregation points for the step-line overlay. */
    windowedPoints: WindowedPoint[];

    /** The annotation region metadata including contig, coordinates, read identifier, and raw BED line. */
    annotation: {
        /** The contig or chromosome name for the annotation. */
        contig: string;

        /** The start position of the annotation in base pairs. */
        start: number;

        /** The end position of the annotation in base pairs. */
        end: number;

        /** The nanopore read identifier associated with this annotation. */
        readId: string;

        /** The original unparsed line from the BED file, used to extract extra columns. */
        rawLine: string;
    };

    /** The expanded genomic region used for the plot viewport. */
    expandedRegion: {
        /** The contig or chromosome name for the expanded region. */
        contig: string;

        /** The start position of the expanded viewing region in base pairs. */
        start: number;

        /** The end position of the expanded viewing region in base pairs. */
        end: number;
    };

    /** Warning message if annotation coordinates were clamped to contig bounds. */
    clampWarning?: string;
}

/**
 * Represents the result returned after an accept or reject action.
 */
interface ActionResult {
    /** Whether all annotations have been reviewed. */
    done: boolean;

    /** The updated application state after the action. */
    state: AppState;

    /** The plot data for the next annotation, or null if unavailable. */
    plotData?: PlotData | null;
}

/**
 * The preload-exposed API for communicating swipe decisions to the main process.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: SwipeApi;
    }
).api;

let chart: ChartInstance | null = null;
let isProcessing = false;
let isInitialized = false;
let showAnnotationHighlight = true;

/**
 * Cached references to the DOM elements used throughout the swipe UI.
 */
const elements = {
    /** The heading element displaying the current annotation title. */
    title: document.getElementById("plot-title") as HTMLElement,

    /** The canvas element on which the Chart.js plot is rendered. */
    chartCanvas: document.getElementById("chart") as HTMLCanvasElement,

    /** The overlay element shown while data is loading. */
    loadingOverlay: document.getElementById("loading-overlay") as HTMLElement,

    /** The element displayed when no plot data is available for the current annotation. */
    noDataMessage: document.getElementById("no-data-message") as HTMLElement,

    /** The element displayed when all annotations have been reviewed. */
    doneMessage: document.getElementById("done-message") as HTMLElement,

    /** The element displaying the final accept and reject counts. */
    summary: document.getElementById("summary") as HTMLElement,

    /** The progress bar fill element whose width indicates review progress. */
    progressFill: document.getElementById("progress-fill") as HTMLElement,

    /** The text element displaying the current index out of total count. */
    progressText: document.getElementById("progress-text") as HTMLElement,

    /** The overlay element used for the accept and reject flash animations. */
    flashOverlay: document.getElementById("flash-overlay") as HTMLElement,

    /** The warning banner shown when annotation coordinates are clamped. */
    clampWarning: document.getElementById("clamp-warning") as HTMLElement,

    /** The info strip showing extra BED columns beyond the four mandatory fields. */
    bedExtraInfo: document.getElementById("bed-extra-info") as HTMLElement,

    /** The element displaying the output file path after completion. */
    outputInfo: document.getElementById("output-info") as HTMLElement,
};

/**
 * Shows the loading overlay and hides other status messages.
 */
function showLoading() {
    elements.loadingOverlay.classList.remove("hidden");
    elements.noDataMessage.classList.add("hidden");
    elements.doneMessage.classList.add("hidden");
}

/**
 * Hides the loading overlay.
 */
function hideLoading() {
    elements.loadingOverlay.classList.add("hidden");
}

/**
 * Shows the no-data message and hides the loading and done overlays.
 */
function showNoData() {
    elements.loadingOverlay.classList.add("hidden");
    elements.noDataMessage.classList.remove("hidden");
    elements.doneMessage.classList.add("hidden");
}

/**
 * Shows the completion message with a summary of accepted and rejected counts.
 *
 * @param state - The final application state containing the decision counts.
 */
function showDone(state: AppState) {
    elements.loadingOverlay.classList.add("hidden");
    elements.noDataMessage.classList.add("hidden");
    elements.doneMessage.classList.remove("hidden");
    elements.summary.textContent = `Accepted: ${state.acceptedCount} | Rejected: ${state.rejectedCount}`;
    if (state.outputPath) {
        elements.outputInfo.textContent = `Results saved to: ${state.outputPath}`;
    }
}

/**
 * Updates the progress bar and text to reflect the current review position.
 *
 * @param state - The current application state with index and total counts.
 */
function updateProgress(state: AppState) {
    const progress =
        state.totalCount > 0
            ? (state.currentIndex / state.totalCount) * 100
            : 0;
    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `${state.currentIndex} / ${state.totalCount}`;
}

/**
 * Updates the title element to display the current annotation region and read identifier.
 *
 * @param plotData - The plot data containing annotation metadata, or null if unavailable.
 */
function updateTitle(plotData: PlotData | null) {
    if (plotData) {
        const { annotation } = plotData;
        elements.title.textContent = `Showing ${annotation.contig}:${annotation.start.toLocaleString()}-${annotation.end.toLocaleString()} on read id ${annotation.readId}`;
    } else {
        elements.title.textContent = "No data";
    }
}

/**
 * Shows or hides the extra BED fields info strip based on the plot data.
 * Columns beyond the four mandatory BED fields (contig, start, end, readId)
 * are extracted from the raw line and displayed as dot-separated values.
 *
 * @param plotData - The plot data whose annotation may have extra BED columns, or null to hide.
 */
function updateBedExtraInfo(plotData: PlotData | null) {
    if (!plotData) {
        elements.bedExtraInfo.classList.add("hidden");
        return;
    }

    const fields = plotData.annotation.rawLine.split("\t");
    const extraFields = fields.slice(4);

    if (extraFields.length === 0) {
        elements.bedExtraInfo.classList.add("hidden");
        return;
    }

    elements.bedExtraInfo.textContent = `Additional BED fields (separated by ·): ${extraFields.join(" · ")}`;
    elements.bedExtraInfo.classList.remove("hidden");
}

/**
 * Shows or hides the clamp warning banner based on the plot data.
 *
 * @param plotData - The plot data that may contain a clamp warning, or null to hide.
 */
function updateClampWarning(plotData: PlotData | null) {
    if (plotData?.clampWarning) {
        elements.clampWarning.textContent = plotData.clampWarning;
        elements.clampWarning.classList.remove("hidden");
    } else {
        elements.clampWarning.classList.add("hidden");
    }
}

/**
 * Triggers a brief colour flash overlay to give visual feedback for an accept or reject action.
 *
 * @param type - The action type determining the flash colour.
 */
function flash(type: "accept" | "reject") {
    const className = type === "accept" ? "flash-accept" : "flash-reject";
    elements.flashOverlay.classList.add(className);
    setTimeout(() => {
        elements.flashOverlay.classList.remove(className);
    }, 150);
}

/**
 * Renders the modification probability chart using Chart.js with raw scatter points and a windowed step line.
 *
 * @param plotData - The plot data containing raw points, windowed points, and region metadata.
 */
function renderChart(plotData: PlotData) {
    const ctx = elements.chartCanvas.getContext("2d");
    if (!ctx) return;

    if (chart) {
        chart.destroy();
    }

    const { rawPoints, windowedPoints, annotation, expandedRegion } = plotData;

    // Build explicit horizontal segments for each window with vertical
    // connectors between them, avoiding Chart.js stepped interpolation.
    const stepLineData: PlotDataPoint[] = [];
    for (const wp of windowedPoints) {
        stepLineData.push({ x: wp.refWinStart, y: wp.winVal });
        stepLineData.push({ x: wp.refWinEnd, y: wp.winVal });
    }

    chart = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Raw calls",
                    data: rawPoints,
                    backgroundColor: "rgba(128, 128, 128, 0.4)",
                    borderColor: "transparent",
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    order: 2,
                },
                {
                    label: "Windowed calls",
                    data: stepLineData,
                    type: "line",
                    backgroundColor: "transparent",
                    borderColor: "black",
                    borderWidth: 2.5,
                    pointRadius: 0,
                    order: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 200,
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    align: "end",
                    labels: {
                        color: "#333",
                        usePointStyle: true,
                    },
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        /**
                         * Formats the tooltip label showing position and value.
                         *
                         * @param context - The Chart.js tooltip context containing the raw data point.
                         * @param context.raw - The raw data point behind this tooltip.
                         * @returns The formatted tooltip label string.
                         */
                        label: (context: {
                            /** The raw data point behind this tooltip. */
                            raw: PlotDataPoint;
                        }) => {
                            const point = context.raw;
                            return `Position: ${Math.round(point.x).toLocaleString()}, Value: ${point.y.toFixed(3)}`;
                        },
                    },
                },
                annotation: {
                    annotations: showAnnotationHighlight
                        ? {
                              regionBox: {
                                  type: "box",
                                  xMin: annotation.start,
                                  xMax: annotation.end,
                                  backgroundColor: "rgba(76, 175, 80, 0.15)",
                                  borderColor: "rgba(76, 175, 80, 0.6)",
                                  borderWidth: 1,
                              },
                          }
                        : {},
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: expandedRegion.start,
                    max: expandedRegion.end,
                    title: {
                        display: true,
                        text: "Genomic Position (bp)",
                        color: "#333",
                    },
                    ticks: {
                        color: "#666",
                        /**
                         * Formats tick values with locale-aware number formatting.
                         *
                         * @param value - The raw numeric tick value.
                         * @returns The formatted tick label string.
                         */
                        callback: (value: number) => value.toLocaleString(),
                    },
                    grid: {
                        color: "rgba(0, 0, 0, 0.1)",
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: "Modification level",
                        color: "#333",
                    },
                    ticks: {
                        color: "#666",
                    },
                    grid: {
                        color: "rgba(0, 0, 0, 0.1)",
                    },
                    min: 0,
                    max: 1,
                },
            },
        },
    });
}

/**
 * Handles an accept or reject action by sending it to the main process and updating the UI accordingly.
 *
 * @param action - The swipe action to perform.
 */
async function handleAction(action: "accept" | "reject") {
    if (isProcessing) return;
    isProcessing = true;

    flash(action);

    showLoading();

    try {
        const result =
            action === "accept" ? await api.accept() : await api.reject();

        updateProgress(result.state);

        if (result.done) {
            updateClampWarning(null);
            updateBedExtraInfo(null);
            showDone(result.state);
        } else if (
            result.plotData &&
            (result.plotData.rawPoints.length > 0 ||
                result.plotData.windowedPoints.length > 0)
        ) {
            hideLoading();
            updateTitle(result.plotData);
            updateClampWarning(result.plotData);
            updateBedExtraInfo(result.plotData);
            renderChart(result.plotData);
        } else {
            updateTitle(result.plotData ?? null);
            updateClampWarning(result.plotData ?? null);
            updateBedExtraInfo(result.plotData ?? null);
            showNoData();
        }
    } catch (error) {
        console.error("Error handling action:", error);
        hideLoading();
    }

    isProcessing = false;
}

/**
 * Initializes the swipe UI by loading the application state and rendering the first plot.
 */
async function initialize() {
    showLoading();

    try {
        const state = await api.getState();
        showAnnotationHighlight = state.showAnnotationHighlight !== false;
        updateProgress(state);

        if (state.totalCount === 0) {
            elements.title.textContent = "No annotations to review";
            hideLoading();
            isInitialized = true;
            return;
        }

        const plotData = await api.getPlotData();

        if (
            plotData &&
            (plotData.rawPoints.length > 0 ||
                plotData.windowedPoints.length > 0)
        ) {
            hideLoading();
            updateTitle(plotData);
            updateClampWarning(plotData);
            updateBedExtraInfo(plotData);
            renderChart(plotData);
        } else {
            updateTitle(plotData);
            updateClampWarning(plotData);
            updateBedExtraInfo(plotData);
            showNoData();
        }

        isInitialized = true;
    } catch (error) {
        console.error("Error initializing:", error);
        elements.title.textContent = "Error loading data";
        hideLoading();
        isInitialized = true;
    }
}

document.addEventListener("keydown", (event) => {
    if (!isInitialized) return;

    if (event.key === "ArrowRight") {
        event.preventDefault();
        handleAction("accept");
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleAction("reject");
    }
});

const rejectButton = document.querySelector(".control-hint.left");
const acceptButton = document.querySelector(".control-hint.right");

if (rejectButton) {
    rejectButton.addEventListener("click", () => {
        if (!isInitialized) return;
        handleAction("reject");
    });
}

if (acceptButton) {
    acceptButton.addEventListener("click", () => {
        if (!isInitialized) return;
        handleAction("accept");
    });
}

initialize();
