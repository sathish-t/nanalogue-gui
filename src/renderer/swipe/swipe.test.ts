// Tests for swipe.html template structure and default state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reads the swipe.html template and injects it into the jsdom document body.
 * Returns the document for querying.
 *
 * @returns The document with the swipe.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "swipe.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

/**
 * Shape of the mocked preload API used by these renderer tests.
 */
interface SwipeMockApi {
    /** Resolves the current swipe state. */
    getState: ReturnType<typeof vi.fn>;
    /** Resolves the plot data for the active annotation. */
    getPlotData: ReturnType<typeof vi.fn>;
    /** Resolves an accept action. */
    accept: ReturnType<typeof vi.fn>;
    /** Resolves a reject action. */
    reject: ReturnType<typeof vi.fn>;
    /** Resolves a back-navigation action. */
    swipeGoBack: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock preload API for the swipe renderer.
 *
 * @returns A mock API object compatible with the swipe renderer.
 */
function createMockApi(): SwipeMockApi {
    return {
        getState: vi.fn().mockResolvedValue({
            currentIndex: 0,
            totalCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
        }),
        getPlotData: vi.fn().mockResolvedValue(null),
        accept: vi.fn().mockResolvedValue({
            done: false,
            state: {
                currentIndex: 0,
                totalCount: 0,
                acceptedCount: 0,
                rejectedCount: 0,
            },
            plotData: null,
        }),
        reject: vi.fn().mockResolvedValue({
            done: false,
            state: {
                currentIndex: 0,
                totalCount: 0,
                acceptedCount: 0,
                rejectedCount: 0,
            },
            plotData: null,
        }),
        swipeGoBack: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Waits for the renderer's async initialization to settle.
 */
async function yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Waits for a fixed amount of time so timer-based UI cleanup can run.
 *
 * @param ms - The number of milliseconds to wait.
 */
async function waitFor(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * The subset of the global window object used by these tests.
 */
interface SwipeTestWindow {
    /** The preload-exposed API. */
    api: SwipeMockApi;
}

/**
 * Installs the mocked preload API onto the jsdom window.
 *
 * @param api - The mock API to expose as `window.api`.
 */
function setWindowApi(api: SwipeMockApi): void {
    (window as unknown as SwipeTestWindow).api = api;
}

/**
 * Shape of the Chart.js configuration object captured by the harness.
 */
interface ChartMockConfig {
    /** Chart configuration options. */
    options?: ChartMockOptions;
}

/**
 * Chart.js options used by the swipe renderer tests.
 */
interface ChartMockOptions {
    /** Plugin options. */
    plugins?: ChartMockPlugins;
    /** Axis scale options. */
    scales?: ChartMockScales;
}

/**
 * Chart.js plugin options used by the swipe renderer tests.
 */
interface ChartMockPlugins {
    /** Annotation plugin options. */
    annotation?: ChartMockAnnotation;
    /** Tooltip plugin options. */
    tooltip?: ChartMockTooltip;
}

/**
 * Annotation plugin options used by the swipe renderer tests.
 */
interface ChartMockAnnotation {
    /** Named annotations rendered on the chart. */
    annotations?: Record<string, unknown>;
}

/**
 * Tooltip plugin options used by the swipe renderer tests.
 */
interface ChartMockTooltip {
    /** Callback hooks for tooltip rendering. */
    callbacks?: ChartMockTooltipCallbacks;
}

/**
 * Tooltip callback hooks used by the swipe renderer tests.
 */
interface ChartMockTooltipCallbacks {
    /** Formats the tooltip label. */
    label?: (context: ChartMockTooltipContext) => string;
}

/**
 * Tooltip label callback context used by the swipe renderer tests.
 */
interface ChartMockTooltipContext {
    /** The raw tooltip item. */
    raw: ChartMockTooltipPoint;
}

/**
 * Tooltip point data used by the swipe renderer tests.
 */
interface ChartMockTooltipPoint {
    /** The x-value. */
    x: number;
    /** The y-value. */
    y: number;
}

/**
 * Axis scale options used by the swipe renderer tests.
 */
interface ChartMockScales {
    /** X-axis options. */
    x?: ChartMockScaleAxis;
}

/**
 * Axis scale options for the x-axis.
 */
interface ChartMockScaleAxis {
    /** Tick rendering options. */
    ticks?: ChartMockTicks;
}

/**
 * Tick rendering options for a chart axis.
 */
interface ChartMockTicks {
    /** Formats tick labels. */
    callback?: (value: number) => string;
}

/**
 * Installs a Chart.js test harness that records constructor calls and chart
 * destruction.
 * Avoids a real canvas implementation.
 *
 * @returns The spies used by the mock Chart constructor.
 */
function installChartHarness() {
    const chartCtorSpy = vi.fn();
    const chartDestroySpy = vi.fn();

    /**
     * Captures Chart.js constructor calls for assertions.
     *
     * @param ctx - The mocked canvas context.
     * @param config - The Chart.js configuration object.
     * @returns A minimal chart instance with a destroy spy.
     */
    function chartMock(
        this: unknown,
        ctx: CanvasRenderingContext2D,
        config: Record<string, unknown>,
    ) {
        chartCtorSpy(ctx, config);
        return { destroy: chartDestroySpy };
    }

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        {} as CanvasRenderingContext2D,
    );
    vi.stubGlobal("Chart", chartMock);

    return { chartCtorSpy, chartDestroySpy };
}

/**
 * Creates a reusable plot-data payload for behavior tests.
 *
 * @param rawLine - The raw BED line to embed in the annotation.
 * @param clampWarning - Optional clamp warning text.
 * @returns A plot-data object with one raw point and one windowed point.
 */
function makePlotData(rawLine: string, clampWarning?: string) {
    return {
        rawPoints: [{ x: 1, y: 0.25 }],
        windowedPoints: [
            {
                refWinStart: 1000,
                refWinEnd: 1100,
                winVal: 0.4,
            },
        ],
        annotation: {
            contig: "chr1",
            start: 1000,
            end: 2000,
            readId: "read-1",
            rawLine,
        },
        expandedRegion: {
            contig: "chr1",
            start: 900,
            end: 2100,
        },
        ...(clampWarning ? { clampWarning } : {}),
    };
}

describe("swipe.html", () => {
    let mockApi: ReturnType<typeof createMockApi>;

    beforeEach(() => {
        vi.resetModules();
        loadTemplate();
        mockApi = createMockApi();
        setWindowApi(mockApi);
    });

    afterEach(() => {
        document.documentElement.innerHTML = "";
        Reflect.deleteProperty(globalThis, "Chart");
        vi.restoreAllMocks();
    });

    describe("title bar", () => {
        it("has a back button", () => {
            const btn = document.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
            expect(btn?.classList.contains("back-button")).toBe(true);
            expect(btn?.getAttribute("aria-label")).toBe("Back to home");
            expect(btn?.textContent).toContain("Back");
        });

        it("has a plot title heading", () => {
            const title =
                document.querySelector<HTMLHeadingElement>("#plot-title");
            expect(title).not.toBeNull();
            expect(title?.tagName.toLowerCase()).toBe("h1");
            expect(title?.textContent).toBe("Loading...");
        });

        it("wires the back button to swipeGoBack", async () => {
            await import("./swipe");
            await yieldToEventLoop();

            const btn = document.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            btn?.click();
            expect(mockApi.swipeGoBack).toHaveBeenCalledTimes(1);
        });
    });

    describe("flash overlay", () => {
        it("has a flash-overlay element", () => {
            const overlay = document.querySelector("#flash-overlay");
            expect(overlay).not.toBeNull();
        });
    });

    describe("clamp warning", () => {
        it("exists and starts hidden", () => {
            const warning = document.querySelector("#clamp-warning");
            expect(warning).not.toBeNull();
            expect(warning?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("chart", () => {
        it("has a chart canvas", () => {
            const canvas = document.querySelector("#chart");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });
    });

    describe("loading overlay", () => {
        it("has a loading-overlay element", () => {
            const overlay = document.querySelector("#loading-overlay");
            expect(overlay).not.toBeNull();
        });

        it("contains a spinner", () => {
            const spinner = document.querySelector("#loading-overlay .spinner");
            expect(spinner).not.toBeNull();
        });
    });

    describe("no-data message", () => {
        it("exists and starts hidden", () => {
            const noData = document.querySelector("#no-data-message");
            expect(noData).not.toBeNull();
            expect(noData?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("done message", () => {
        it("exists and starts hidden", () => {
            const done = document.querySelector("#done-message");
            expect(done).not.toBeNull();
            expect(done?.classList.contains("hidden")).toBe(true);
        });

        it("has a summary paragraph", () => {
            const summary = document.querySelector("#summary");
            expect(summary).not.toBeNull();
        });

        it("has an output-info paragraph", () => {
            const outputInfo = document.querySelector("#output-info");
            expect(outputInfo).not.toBeNull();
        });
    });

    describe("controls", () => {
        it("has a left (reject) control", () => {
            const left = document.querySelector(".control-hint.left");
            expect(left).not.toBeNull();
            const label = left?.querySelector(".label");
            expect(label?.textContent).toBe("REJECT");
        });

        it("has a right (accept) control", () => {
            const right = document.querySelector(".control-hint.right");
            expect(right).not.toBeNull();
            const label = right?.querySelector(".label");
            expect(label?.textContent).toBe("ACCEPT");
        });

        it("has keyboard shortcut indicators", () => {
            const keys = document.querySelectorAll(".key");
            expect(keys).toHaveLength(2);
        });
    });

    describe("progress bar", () => {
        it("has a progress container", () => {
            const container = document.querySelector("#progress-container");
            expect(container).not.toBeNull();
        });

        it("has a progress bar with fill element", () => {
            const bar = document.querySelector("#progress-bar");
            const fill = document.querySelector("#progress-fill");
            expect(bar).not.toBeNull();
            expect(fill).not.toBeNull();
        });

        it("has progress text showing 0 / 0", () => {
            const text = document.querySelector("#progress-text");
            expect(text?.textContent).toBe("0 / 0");
        });
    });

    describe("swipe renderer behavior", () => {
        it("initializes the no-annotation state and returns to landing from Back", async () => {
            const { chartCtorSpy } = installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 0,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: false,
            });

            await import("./swipe");
            await yieldToEventLoop();

            expect(document.querySelector("#plot-title")?.textContent).toBe(
                "No annotations to review",
            );
            expect(
                document
                    .querySelector("#loading-overlay")
                    ?.classList.contains("hidden"),
            ).toBe(true);
            expect(mockApi.getPlotData).not.toHaveBeenCalled();
            expect(chartCtorSpy).not.toHaveBeenCalled();

            document.querySelector<HTMLButtonElement>("#btn-back")?.click();
            await yieldToEventLoop();

            expect(mockApi.swipeGoBack).toHaveBeenCalledTimes(1);
        });

        it("renders a plot with extra BED fields and hides the annotation highlight", async () => {
            const { chartCtorSpy } = installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: false,
            });
            mockApi.getPlotData.mockResolvedValueOnce(
                makePlotData(
                    "chr1\t1000\t2000\tread-1\tfieldA\tfieldB",
                    "clamped",
                ),
            );

            await import("./swipe");
            await yieldToEventLoop();

            expect(document.querySelector("#plot-title")?.textContent).toBe(
                "Showing chr1:1,000-2,000 on read id read-1",
            );
            expect(
                document
                    .querySelector("#clamp-warning")
                    ?.classList.contains("hidden"),
            ).toBe(false);
            expect(document.querySelector("#clamp-warning")?.textContent).toBe(
                "clamped",
            );
            expect(
                document
                    .querySelector("#bed-extra-info")
                    ?.classList.contains("hidden"),
            ).toBe(false);
            expect(document.querySelector("#bed-extra-info")?.textContent).toBe(
                "Additional BED fields (separated by ·): fieldA · fieldB",
            );
            expect(chartCtorSpy).toHaveBeenCalledTimes(1);
            const config = chartCtorSpy.mock.calls[0][1] as ChartMockConfig;
            expect(config.options?.plugins?.annotation?.annotations).toEqual(
                {},
            );
            expect(
                config.options?.plugins?.tooltip?.callbacks?.label?.({
                    raw: { x: 1234.2, y: 0.56789 },
                }),
            ).toBe("Position: 1,234, Value: 0.568");
            expect(config.options?.scales?.x?.ticks?.callback?.(1234)).toBe(
                "1,234",
            );
        });

        it("shows the no-data overlay when the plot has no points", async () => {
            installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            mockApi.getPlotData.mockResolvedValueOnce({
                rawPoints: [],
                windowedPoints: [],
                annotation: {
                    contig: "chr1",
                    start: 1000,
                    end: 2000,
                    readId: "read-1",
                    rawLine: "chr1\t1000\t2000\tread-1",
                },
                expandedRegion: {
                    contig: "chr1",
                    start: 900,
                    end: 2100,
                },
            });

            await import("./swipe");
            await yieldToEventLoop();

            expect(document.querySelector("#plot-title")?.textContent).toBe(
                "Showing chr1:1,000-2,000 on read id read-1",
            );
            expect(
                document
                    .querySelector("#no-data-message")
                    ?.classList.contains("hidden"),
            ).toBe(false);
            expect(
                document
                    .querySelector("#bed-extra-info")
                    ?.classList.contains("hidden"),
            ).toBe(true);
        });

        it("falls back to a No data title when plot data is null", async () => {
            installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            mockApi.getPlotData.mockResolvedValueOnce(null);

            await import("./swipe");
            await yieldToEventLoop();

            expect(document.querySelector("#plot-title")?.textContent).toBe(
                "No data",
            );
            expect(
                document
                    .querySelector("#no-data-message")
                    ?.classList.contains("hidden"),
            ).toBe(false);
            expect(
                document
                    .querySelector("#clamp-warning")
                    ?.classList.contains("hidden"),
            ).toBe(true);
            expect(
                document
                    .querySelector("#bed-extra-info")
                    ?.classList.contains("hidden"),
            ).toBe(true);
        });

        it("re-renders on accept and destroys the previous chart", async () => {
            const { chartCtorSpy, chartDestroySpy } = installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 2,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            const firstPlot = makePlotData("chr1\t1000\t2000\tread-1");
            const secondPlot = makePlotData("chr1\t2000\t3000\tread-1");
            const thirdPlot = makePlotData("chr1\t3000\t4000\tread-1");
            mockApi.getPlotData.mockResolvedValueOnce(firstPlot);
            mockApi.accept
                .mockResolvedValueOnce({
                    done: false,
                    state: {
                        currentIndex: 1,
                        totalCount: 2,
                        acceptedCount: 1,
                        rejectedCount: 0,
                    },
                    plotData: secondPlot,
                })
                .mockResolvedValueOnce({
                    done: false,
                    state: {
                        currentIndex: 2,
                        totalCount: 2,
                        acceptedCount: 2,
                        rejectedCount: 0,
                    },
                    plotData: thirdPlot,
                });

            await import("./swipe");
            await yieldToEventLoop();

            const acceptButton = document.querySelector<HTMLButtonElement>(
                ".control-hint.right",
            );
            acceptButton?.click();
            await yieldToEventLoop();
            await waitFor(200);
            acceptButton?.click();
            await yieldToEventLoop();
            await waitFor(200);

            expect(mockApi.accept).toHaveBeenCalledTimes(2);
            expect(chartCtorSpy).toHaveBeenCalledTimes(3);
            expect(chartDestroySpy).toHaveBeenCalledTimes(2);
            expect(document.querySelector("#progress-text")?.textContent).toBe(
                "2 / 2",
            );
        });

        it("shows the completion summary when reject finishes the review", async () => {
            installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            mockApi.getPlotData.mockResolvedValueOnce(
                makePlotData("chr1\t1000\t2000\tread-1"),
            );
            mockApi.reject.mockResolvedValueOnce({
                done: true,
                state: {
                    currentIndex: 1,
                    totalCount: 1,
                    acceptedCount: 5,
                    rejectedCount: 7,
                    outputPath: "/tmp/out.bed",
                },
                plotData: null,
            });

            await import("./swipe");
            await yieldToEventLoop();

            document
                .querySelector<HTMLButtonElement>(".control-hint.left")
                ?.click();
            await yieldToEventLoop();
            await waitFor(200);

            expect(
                document
                    .querySelector("#done-message")
                    ?.classList.contains("hidden"),
            ).toBe(false);
            expect(document.querySelector("#summary")?.textContent).toBe(
                "Accepted: 5 | Rejected: 7",
            );
            expect(document.querySelector("#output-info")?.textContent).toBe(
                "Results saved to: /tmp/out.bed",
            );
        });

        it("handles keyboard shortcuts for accept and reject", async () => {
            installChartHarness();
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            mockApi.getPlotData.mockResolvedValueOnce(
                makePlotData("chr1\t1000\t2000\tread-1"),
            );
            mockApi.accept.mockResolvedValueOnce({
                done: false,
                state: {
                    currentIndex: 1,
                    totalCount: 1,
                    acceptedCount: 1,
                    rejectedCount: 0,
                },
                plotData: null,
            });
            mockApi.reject.mockResolvedValueOnce({
                done: false,
                state: {
                    currentIndex: 1,
                    totalCount: 1,
                    acceptedCount: 1,
                    rejectedCount: 1,
                },
                plotData: null,
            });

            await import("./swipe");
            await yieldToEventLoop();

            const rightEvent = new KeyboardEvent("keydown", {
                key: "ArrowRight",
                bubbles: true,
                cancelable: true,
            });
            document.dispatchEvent(rightEvent);
            expect(rightEvent.defaultPrevented).toBe(true);
            await yieldToEventLoop();
            await waitFor(200);

            const leftEvent = new KeyboardEvent("keydown", {
                key: "ArrowLeft",
                bubbles: true,
                cancelable: true,
            });
            document.dispatchEvent(leftEvent);
            expect(leftEvent.defaultPrevented).toBe(true);
            await yieldToEventLoop();
            await waitFor(200);

            expect(mockApi.accept).toHaveBeenCalledTimes(1);
            expect(mockApi.reject).toHaveBeenCalledTimes(1);
        });

        it("logs initialization failures", async () => {
            installChartHarness();
            const error = new Error("init failed");
            const consoleErrorSpy = vi
                .spyOn(console, "error")
                .mockImplementation(() => {});
            mockApi.getState.mockRejectedValueOnce(error);

            await import("./swipe");
            await yieldToEventLoop();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "Error initializing:",
                error,
            );
            expect(document.querySelector("#plot-title")?.textContent).toBe(
                "Error loading data",
            );
        });

        it("logs action failures when accept rejects", async () => {
            installChartHarness();
            const error = new Error("accept failed");
            const consoleErrorSpy = vi
                .spyOn(console, "error")
                .mockImplementation(() => {});
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 1,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: true,
            });
            mockApi.getPlotData.mockResolvedValueOnce(
                makePlotData("chr1\t1000\t2000\tread-1"),
            );
            mockApi.accept.mockRejectedValueOnce(error);

            await import("./swipe");
            await yieldToEventLoop();

            document
                .querySelector<HTMLButtonElement>(".control-hint.right")
                ?.click();
            await yieldToEventLoop();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "Error handling action:",
                error,
            );
            expect(
                document
                    .querySelector("#loading-overlay")
                    ?.classList.contains("hidden"),
            ).toBe(true);
        });

        it("logs back-navigation failures", async () => {
            installChartHarness();
            const error = new Error("back failed");
            const consoleErrorSpy = vi
                .spyOn(console, "error")
                .mockImplementation(() => {});
            mockApi.getState.mockResolvedValueOnce({
                currentIndex: 0,
                totalCount: 0,
                acceptedCount: 0,
                rejectedCount: 0,
                showAnnotationHighlight: false,
            });
            mockApi.swipeGoBack.mockRejectedValueOnce(error);

            await import("./swipe");
            await yieldToEventLoop();

            document.querySelector<HTMLButtonElement>("#btn-back")?.click();
            await yieldToEventLoop();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                "Error navigating back to landing:",
                error,
            );
        });
    });
});
