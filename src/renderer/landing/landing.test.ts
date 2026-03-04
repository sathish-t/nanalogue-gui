// Tests for landing.html template structure and default state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the landing.html template and injects it into the jsdom document body.
 * Returns the document for querying.
 *
 * @returns The document with the landing.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "landing.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

describe("landing.html", () => {
    describe("header", () => {
        it("has a heading with the app name", () => {
            const doc = loadTemplate();
            const h1 = doc.querySelector("h1");
            expect(h1).not.toBeNull();
            expect(h1?.textContent).toBe("nanalogue-gui");
        });
    });

    describe("mode selection buttons", () => {
        it("has a swipe mode button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-swipe");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a QC mode button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-qc");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("swipe button has a title and description", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector("#btn-swipe");
            const title = btn?.querySelector(".mode-title");
            const desc = btn?.querySelector(".mode-description");
            expect(title?.textContent).toBe("Swipe");
            expect(desc?.textContent).toContain("annotation");
        });

        it("QC button has a title and description", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector("#btn-qc");
            const title = btn?.querySelector(".mode-title");
            const desc = btn?.querySelector(".mode-description");
            expect(title?.textContent).toBe("QC");
            expect(desc?.textContent).toContain("QC");
        });

        it("has a locate mode button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-locate");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("locate button has a title and description", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector("#btn-locate");
            const title = btn?.querySelector(".mode-title");
            const desc = btn?.querySelector(".mode-description");
            expect(title?.textContent).toBe("Locate reads");
            expect(desc?.textContent).toContain("BED");
        });

        it("has a version button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-version");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("version button has a title and description", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector("#btn-version");
            const title = btn?.querySelector(".mode-title");
            const desc = btn?.querySelector(".mode-description");
            expect(title?.textContent).toBe("Version");
            expect(desc?.textContent).toContain("version");
        });

        it("has exactly 5 mode buttons", () => {
            const doc = loadTemplate();
            const buttons = doc.querySelectorAll(".mode-button");
            expect(buttons).toHaveLength(5);
        });
    });

    describe("font size controls", () => {
        it("has a font-size-controls container", () => {
            const doc = loadTemplate();
            const controls = doc.querySelector("#font-size-controls");
            expect(controls).not.toBeNull();
        });

        it("has exactly three font-size buttons", () => {
            const doc = loadTemplate();
            const btns = doc.querySelectorAll(".font-size-btn");
            expect(btns).toHaveLength(3);
        });

        it("small button has data-size small", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-font-small");
            expect(btn).not.toBeNull();
            expect(btn?.dataset.size).toBe("small");
        });

        it("medium button has data-size medium", () => {
            const doc = loadTemplate();
            const btn =
                doc.querySelector<HTMLButtonElement>("#btn-font-medium");
            expect(btn).not.toBeNull();
            expect(btn?.dataset.size).toBe("medium");
        });

        it("large button has data-size large", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-font-large");
            expect(btn).not.toBeNull();
            expect(btn?.dataset.size).toBe("large");
        });

        it("medium button is pressed by default", () => {
            const doc = loadTemplate();
            const btn =
                doc.querySelector<HTMLButtonElement>("#btn-font-medium");
            expect(btn?.getAttribute("aria-pressed")).toBe("true");
        });

        it("small and large buttons are not pressed by default", () => {
            const doc = loadTemplate();
            const small =
                doc.querySelector<HTMLButtonElement>("#btn-font-small");
            const large =
                doc.querySelector<HTMLButtonElement>("#btn-font-large");
            expect(small?.getAttribute("aria-pressed")).toBe("false");
            expect(large?.getAttribute("aria-pressed")).toBe("false");
        });

        it("font-size-controls uses group role", () => {
            const doc = loadTemplate();
            const controls = doc.querySelector("#font-size-controls");
            expect(controls?.getAttribute("role")).toBe("group");
        });
    });

    describe("page structure", () => {
        it("has a mode-selection main element", () => {
            const doc = loadTemplate();
            const main = doc.querySelector("#mode-selection");
            expect(main).not.toBeNull();
            expect(main?.tagName.toLowerCase()).toBe("main");
        });

        it("has the landing-app root container", () => {
            const doc = loadTemplate();
            const root = doc.querySelector("#landing-app");
            expect(root).not.toBeNull();
        });
    });
});
