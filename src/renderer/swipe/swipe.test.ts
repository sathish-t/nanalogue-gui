// Tests for swipe.html template structure and default state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

describe("swipe.html", () => {
    describe("title bar", () => {
        it("has a plot title heading", () => {
            const doc = loadTemplate();
            const title = doc.querySelector<HTMLHeadingElement>("#plot-title");
            expect(title).not.toBeNull();
            expect(title?.tagName.toLowerCase()).toBe("h1");
            expect(title?.textContent).toBe("Loading...");
        });
    });

    describe("flash overlay", () => {
        it("has a flash-overlay element", () => {
            const doc = loadTemplate();
            const overlay = doc.querySelector("#flash-overlay");
            expect(overlay).not.toBeNull();
        });
    });

    describe("clamp warning", () => {
        it("exists and starts hidden", () => {
            const doc = loadTemplate();
            const warning = doc.querySelector("#clamp-warning");
            expect(warning).not.toBeNull();
            expect(warning?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("chart", () => {
        it("has a chart canvas", () => {
            const doc = loadTemplate();
            const canvas = doc.querySelector("#chart");
            expect(canvas).not.toBeNull();
            expect(canvas?.tagName.toLowerCase()).toBe("canvas");
        });
    });

    describe("loading overlay", () => {
        it("has a loading-overlay element", () => {
            const doc = loadTemplate();
            const overlay = doc.querySelector("#loading-overlay");
            expect(overlay).not.toBeNull();
        });

        it("contains a spinner", () => {
            const doc = loadTemplate();
            const spinner = doc.querySelector("#loading-overlay .spinner");
            expect(spinner).not.toBeNull();
        });
    });

    describe("no-data message", () => {
        it("exists and starts hidden", () => {
            const doc = loadTemplate();
            const noData = doc.querySelector("#no-data-message");
            expect(noData).not.toBeNull();
            expect(noData?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("done message", () => {
        it("exists and starts hidden", () => {
            const doc = loadTemplate();
            const done = doc.querySelector("#done-message");
            expect(done).not.toBeNull();
            expect(done?.classList.contains("hidden")).toBe(true);
        });

        it("has a summary paragraph", () => {
            const doc = loadTemplate();
            const summary = doc.querySelector("#summary");
            expect(summary).not.toBeNull();
        });

        it("has an output-info paragraph", () => {
            const doc = loadTemplate();
            const outputInfo = doc.querySelector("#output-info");
            expect(outputInfo).not.toBeNull();
        });
    });

    describe("controls", () => {
        it("has a left (reject) control", () => {
            const doc = loadTemplate();
            const left = doc.querySelector(".control-hint.left");
            expect(left).not.toBeNull();
            const label = left?.querySelector(".label");
            expect(label?.textContent).toBe("REJECT");
        });

        it("has a right (accept) control", () => {
            const doc = loadTemplate();
            const right = doc.querySelector(".control-hint.right");
            expect(right).not.toBeNull();
            const label = right?.querySelector(".label");
            expect(label?.textContent).toBe("ACCEPT");
        });

        it("has keyboard shortcut indicators", () => {
            const doc = loadTemplate();
            const keys = doc.querySelectorAll(".key");
            expect(keys).toHaveLength(2);
        });
    });

    describe("progress bar", () => {
        it("has a progress container", () => {
            const doc = loadTemplate();
            const container = doc.querySelector("#progress-container");
            expect(container).not.toBeNull();
        });

        it("has a progress bar with fill element", () => {
            const doc = loadTemplate();
            const bar = doc.querySelector("#progress-bar");
            const fill = doc.querySelector("#progress-fill");
            expect(bar).not.toBeNull();
            expect(fill).not.toBeNull();
        });

        it("has progress text showing 0 / 0", () => {
            const doc = loadTemplate();
            const text = doc.querySelector("#progress-text");
            expect(text?.textContent).toBe("0 / 0");
        });
    });
});
