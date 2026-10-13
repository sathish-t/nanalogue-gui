// Tests for the QC results template and deferred sequence rendering.
// Uses the real page handlers and template with a stubbed preload API.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateStats } from "../../lib/stats";
import type { QCData } from "./qc-results-types";

/**
 * Reads the qc-results.html template and injects it into the jsdom document body.
 * Returns the document for querying.
 *
 * @returns The document with the qc-results.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "qc-results.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

/**
 * Builds a QC payload with enough sequence rows to span a rendering batch.
 *
 * @returns QC data with empty histograms and eleven distinct sequence read IDs.
 */
function sequenceQCData(): QCData {
    return {
        sampleSeed: 42,
        readLengthStats: calculateStats([]),
        readLengthHistogram: [],
        readLengthBinWidth: 100,
        exceededReadLengths: 0,
        yieldByLength: [],
        wholeReadDensityStats: calculateStats([]),
        wholeReadDensityHistogram: [],
        windowedDensityStats: calculateStats([]),
        windowedDensityHistogram: [],
        rawProbabilityStats: calculateStats([]),
        rawProbabilityHistogram: [],
        readTypeCounts: {
            primaryForward: 0,
            primaryReverse: 0,
            secondaryForward: 0,
            secondaryReverse: 0,
            supplementaryForward: 0,
            supplementaryReverse: 0,
            unmapped: 0,
        },
        seqTableRows: Array.from({ length: 11 }, (_, index) => ({
            readId: `sequence-${index}`,
            sequence: "AZ",
            baseSequence: "AT",
            qualities: [20, 30],
            avgQuality: 25,
        })),
    };
}

/**
 * Starts the real page renderer against the supplied preload result.
 *
 * @param data - The QC data returned by the stubbed preload API.
 */
async function initializeResults(data: QCData): Promise<void> {
    vi.stubGlobal("api", {
        /**
         * Supplies the QC result normally returned over IPC.
         *
         * @returns The test's QC payload.
         */
        getQCData: async () => data,
        goBackToConfig: vi.fn(),
    });
    const { initializeQCResultsPage } = await import("./qc-results-page");
    initializeQCResultsPage();
    await vi.advanceTimersByTimeAsync(0);
    expect(
        document.querySelector("#sample-seed-display")?.textContent,
    ).toContain("Sample seed: 42");
}

describe("QC results deferred sequences", () => {
    beforeEach(() => {
        vi.resetModules();
        loadTemplate();
        vi.useFakeTimers();
        vi.stubGlobal(
            "requestAnimationFrame",
            (callback: FrameRequestCallback) =>
                setTimeout(() => callback(0), 16),
        );
        // jsdom has no canvas drawing implementation; retain the real chart DOM.
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            null,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("renders only on first opening, completes all rows, and does not duplicate on revisits", async () => {
        await initializeResults(sequenceQCData());
        expect(
            document.querySelectorAll("#seq-table-container tbody tr"),
        ).toHaveLength(0);
        expect(document.querySelector(".mini-charts-row")).toBeNull();

        const sequences = document.querySelector<HTMLButtonElement>(
            '[data-tab="sequences"]',
        );
        sequences?.click();
        expect(document.querySelector(".tab-content.active")?.id).toBe(
            "tab-sequences",
        );
        expect(
            document.querySelectorAll("#seq-table-container tbody tr"),
        ).toHaveLength(10);
        expect(document.querySelector(".mini-charts-row")).toBeNull();
        // Revisiting while the next batch is pending must not start another render.
        document
            .querySelector<HTMLButtonElement>('[data-tab="read-lengths"]')
            ?.click();
        sequences?.click();
        await vi.advanceTimersByTimeAsync(16);

        expect(
            Array.from(
                document.querySelectorAll(".seq-read-id"),
                (cell) => cell.textContent,
            ),
        ).toEqual(
            Array.from({ length: 11 }, (_, index) => `sequence-${index}`),
        );
        expect(
            Array.from(
                document.querySelectorAll("#seq-table-container tbody tr"),
                (row) => row.querySelectorAll("td")[2].textContent,
            ),
        ).toEqual(Array(11).fill("AT"));
        expect(document.querySelectorAll(".mini-chart-card")).toHaveLength(3);

        document
            .querySelector<HTMLButtonElement>('[data-tab="read-lengths"]')
            ?.click();
        sequences?.click();
        await vi.advanceTimersByTimeAsync(32);
        expect(
            document.querySelectorAll("#seq-table-container tbody tr"),
        ).toHaveLength(11);
        expect(document.querySelectorAll(".seq-toolbar")).toHaveLength(1);
        expect(document.querySelectorAll(".mini-charts-row")).toHaveLength(1);
    });

    it.each([
        [
            undefined,
            "Region exceeds 500 bp",
            "Sequences not available: Region exceeds 500 bp",
        ],
        [[], undefined, "No reads found in the specified region."],
    ] as const)("shows the empty/skip result after opening sequences (%s)", async (rows, reason, message) => {
        await initializeResults({
            ...sequenceQCData(),
            seqTableRows: rows === undefined ? undefined : [...rows],
            seqTableSkipReason: reason,
        });
        expect(
            document.querySelector("#seq-table-container")?.textContent,
        ).toBe("");
        document
            .querySelector<HTMLButtonElement>('[data-tab="sequences"]')
            ?.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(
            document.querySelector("#seq-table-container")?.textContent,
        ).toBe(message);
        expect(document.querySelector(".mini-charts-row")).toBeNull();
    });

    it("replaces a partial sequence table with an error if deferred rendering fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        await initializeResults(sequenceQCData());
        vi.stubGlobal("requestAnimationFrame", () => {
            throw new Error("Frame scheduling failed");
        });
        document
            .querySelector<HTMLButtonElement>('[data-tab="sequences"]')
            ?.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(
            document.querySelector("#seq-table-container")?.textContent,
        ).toBe(
            "Failed to render sequence results: Error: Frame scheduling failed",
        );
        expect(
            document.querySelectorAll("#seq-table-container tbody tr"),
        ).toHaveLength(0);
        expect(document.querySelector(".mini-charts-row")).toBeNull();
    });
});

describe("qc-results.html", () => {
    describe("header", () => {
        it("has a back button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a QC Results heading", () => {
            const doc = loadTemplate();
            const h1 = doc.querySelector("h1");
            expect(h1).not.toBeNull();
            expect(h1?.textContent).toBe("QC Results");
        });
    });

    describe("tabs", () => {
        it("has 5 tab buttons", () => {
            const doc = loadTemplate();
            const tabs = doc.querySelectorAll(".tab-button");
            expect(tabs).toHaveLength(5);
        });

        it("has tab buttons with correct data-tab values", () => {
            const doc = loadTemplate();
            const tabs = doc.querySelectorAll<HTMLButtonElement>(".tab-button");
            const tabValues = Array.from(tabs).map((t) =>
                t.getAttribute("data-tab"),
            );
            expect(tabValues).toEqual([
                "read-lengths",
                "yield",
                "density",
                "probability",
                "sequences",
            ]);
        });

        it("has read-lengths tab active by default", () => {
            const doc = loadTemplate();
            const activeTab = doc.querySelector(".tab-button.active");
            expect(activeTab?.getAttribute("data-tab")).toBe("read-lengths");
        });

        it("has 5 tab content panels", () => {
            const doc = loadTemplate();
            const panels = doc.querySelectorAll(".tab-content");
            expect(panels).toHaveLength(5);
        });

        it("has read-lengths content panel active by default", () => {
            const doc = loadTemplate();
            const activePanel = doc.querySelector(".tab-content.active");
            expect(activePanel?.id).toBe("tab-read-lengths");
        });
    });

    describe("chart canvases", () => {
        it("has a read-lengths canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart-read-lengths");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });

        it("has a yield canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart-yield");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });

        it("has a whole-density canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart-whole-density");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });

        it("has a windowed-density canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart-windowed-density");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });

        it("has a probability canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart-probability");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });
    });

    describe("stats panels", () => {
        it("has stats panels for all chart types", () => {
            const doc = loadTemplate();
            const ids = [
                "stats-read-lengths",
                "stats-yield",
                "stats-whole-density",
                "stats-windowed-density",
                "stats-probability",
            ];
            for (const id of ids) {
                const panel = doc.querySelector(`#${id}`);
                expect(panel, `missing stats panel #${id}`).not.toBeNull();
            }
        });
    });

    describe("probability filter", () => {
        it("has a filter toggle checkbox", () => {
            const doc = loadTemplate();
            const toggle = doc.querySelector<HTMLInputElement>(
                "#probability-filter-toggle",
            );
            expect(toggle).not.toBeNull();
            expect(toggle?.type).toBe("checkbox");
        });

        it("has low and high number inputs defaulting to 0.05 and 1.00", () => {
            const doc = loadTemplate();
            const low = doc.querySelector<HTMLInputElement>(
                "#probability-filter-low",
            );
            const high = doc.querySelector<HTMLInputElement>(
                "#probability-filter-high",
            );
            expect(low?.type).toBe("number");
            expect(high?.type).toBe("number");
            expect(low?.value).toBe("0.05");
            expect(high?.value).toBe("1.00");
        });

        it("has an apply button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>(
                "#probability-filter-apply",
            );
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has filter inputs hidden by default", () => {
            const doc = loadTemplate();
            const inputs = doc.querySelector("#probability-filter-inputs");
            expect(inputs?.classList.contains("hidden")).toBe(true);
        });

        it("has a hidden error paragraph", () => {
            const doc = loadTemplate();
            const error = doc.querySelector("#probability-filter-error");
            expect(error?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("density filters", () => {
        it("has whole-density filter controls", () => {
            const doc = loadTemplate();
            expect(
                doc.querySelector("#whole-density-filter-toggle"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#whole-density-filter-low"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#whole-density-filter-high"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#whole-density-filter-apply"),
            ).not.toBeNull();
        });

        it("has windowed-density filter controls", () => {
            const doc = loadTemplate();
            expect(
                doc.querySelector("#windowed-density-filter-toggle"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#windowed-density-filter-low"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#windowed-density-filter-high"),
            ).not.toBeNull();
            expect(
                doc.querySelector("#windowed-density-filter-apply"),
            ).not.toBeNull();
        });

        it("has density filter inputs hidden by default", () => {
            const doc = loadTemplate();
            const wholeInputs = doc.querySelector(
                "#whole-density-filter-inputs",
            );
            const windowedInputs = doc.querySelector(
                "#windowed-density-filter-inputs",
            );
            expect(wholeInputs?.classList.contains("hidden")).toBe(true);
            expect(windowedInputs?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("density tab headings", () => {
        it("has a whole-read density heading", () => {
            const doc = loadTemplate();
            const headings = doc.querySelectorAll(".density-heading");
            expect(headings.length).toBeGreaterThanOrEqual(1);
            expect(headings[0].textContent).toContain("Whole-read");
        });

        it("has a windowed density heading", () => {
            const doc = loadTemplate();
            const heading = doc.querySelector(".density-heading-spaced");
            expect(heading).not.toBeNull();
            expect(heading?.textContent).toContain("Windowed");
        });
    });
});
