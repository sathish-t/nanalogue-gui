// Tests for swipe-config.html template structure and default state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the swipe-config.html template and injects it into the jsdom document body.
 * Returns the document for querying.
 *
 * @returns The document with the swipe-config.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "swipe-config.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

describe("swipe-config.html", () => {
    describe("header", () => {
        it("has a back button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a Swipe Configuration heading", () => {
            const doc = loadTemplate();
            const h1 = doc.querySelector("h1");
            expect(h1?.textContent).toBe("Swipe Configuration");
        });
    });

    describe("file inputs", () => {
        it("has a readonly BAM path text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#bam-path");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.readOnly).toBe(true);
        });

        it("has a readonly BED path text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#bed-path");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.readOnly).toBe(true);
        });

        it("has a readonly output path text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#output-path");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.readOnly).toBe(true);
        });
    });

    describe("browse buttons", () => {
        it("has a browse button for BAM file", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-browse-bam");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a browse button for BED file", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-browse-bed");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a browse button for output file", () => {
            const doc = loadTemplate();
            const btn =
                doc.querySelector<HTMLButtonElement>("#btn-browse-output");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });
    });

    describe("overwrite confirmation", () => {
        it("has a file-exists warning that starts hidden", () => {
            const doc = loadTemplate();
            const warning = doc.querySelector("#file-exists-warning");
            expect(warning).not.toBeNull();
            expect(warning?.classList.contains("hidden")).toBe(true);
        });

        it("has an overwrite confirmation label that starts hidden", () => {
            const doc = loadTemplate();
            const confirm = doc.querySelector("#overwrite-confirm");
            expect(confirm).not.toBeNull();
            expect(confirm?.classList.contains("hidden")).toBe(true);
        });

        it("has an overwrite checkbox", () => {
            const doc = loadTemplate();
            const checkbox = doc.querySelector<HTMLInputElement>(
                "#overwrite-checkbox",
            );
            expect(checkbox).not.toBeNull();
            expect(checkbox?.type).toBe("checkbox");
        });
    });

    describe("modification filter", () => {
        it("has a mod-filter text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#mod-filter");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
        });

        it("has a validation hint that starts hidden", () => {
            const doc = loadTemplate();
            const hint = doc.querySelector("#mod-filter-hint");
            expect(hint).not.toBeNull();
            expect(hint?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("flanking region", () => {
        it("has a flanking-region number input defaulting to 1000", () => {
            const doc = loadTemplate();
            const input =
                doc.querySelector<HTMLInputElement>("#flanking-region");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("number");
            expect(input?.value).toBe("1000");
        });

        it("starts disabled", () => {
            const doc = loadTemplate();
            const input =
                doc.querySelector<HTMLInputElement>("#flanking-region");
            expect(input?.disabled).toBe(true);
        });
    });

    describe("annotation highlight", () => {
        it("has a show-annotation-highlight checkbox that starts checked", () => {
            const doc = loadTemplate();
            const checkbox = doc.querySelector<HTMLInputElement>(
                "#show-annotation-highlight",
            );
            expect(checkbox).not.toBeNull();
            expect(checkbox?.type).toBe("checkbox");
            expect(checkbox?.checked).toBe(true);
        });

        it("starts disabled", () => {
            const doc = loadTemplate();
            const checkbox = doc.querySelector<HTMLInputElement>(
                "#show-annotation-highlight",
            );
            expect(checkbox?.disabled).toBe(true);
        });
    });

    describe("start button", () => {
        it("has a start button that starts disabled", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-start");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
            expect(btn?.disabled).toBe(true);
        });
    });

    describe("more-info dialog", () => {
        it("has a dialog element with id more-info-dialog", () => {
            const doc = loadTemplate();
            const dialog = doc.querySelector("#more-info-dialog");
            expect(dialog).not.toBeNull();
            expect(dialog?.tagName.toLowerCase()).toBe("dialog");
        });

        it("has a close button inside the dialog", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>(
                "#more-info-dialog #more-info-close",
            );
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });
    });

    describe("loading overlay", () => {
        it("exists with id loading-overlay", () => {
            const doc = loadTemplate();
            const overlay = doc.querySelector("#loading-overlay");
            expect(overlay).not.toBeNull();
        });

        it("starts with the hidden class", () => {
            const doc = loadTemplate();
            const overlay = doc.querySelector("#loading-overlay");
            expect(overlay?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("summary section", () => {
        it("has a file-summary container", () => {
            const doc = loadTemplate();
            const summary = doc.querySelector("#file-summary");
            expect(summary).not.toBeNull();
        });

        it("has placeholder text by default", () => {
            const doc = loadTemplate();
            const placeholder = doc.querySelector(
                "#file-summary .placeholder-text",
            );
            expect(placeholder).not.toBeNull();
            expect(placeholder?.textContent).toContain("Select files");
        });
    });
});
