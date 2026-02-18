// Tests for qc-results.html template structure and default state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
