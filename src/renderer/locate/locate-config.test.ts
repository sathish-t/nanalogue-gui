// Tests for locate-config.html template structure and default form state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the locate-config.html template and injects it into the jsdom document.
 * Returns the document for querying.
 *
 * @returns The document with the locate-config.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "locate-config.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

describe("locate-config.html", () => {
    describe("header", () => {
        it("has a back button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a 'Locate Reads' heading", () => {
            const doc = loadTemplate();
            const h1 = doc.querySelector("h1");
            expect(h1?.textContent).toBe("Locate Reads");
        });
    });

    describe("BAM source section", () => {
        it("has a bam-resource-input custom element", () => {
            const doc = loadTemplate();
            const el = doc.querySelector("bam-resource-input#bam-source");
            expect(el).not.toBeNull();
        });
    });

    describe("read ID file section", () => {
        it("has a readonly read-id-path text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#read-id-path");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.readOnly).toBe(true);
        });

        it("has a browse button for the read ID file", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>(
                "#btn-browse-read-ids",
            );
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });
    });

    describe("region section", () => {
        it("has a region text input with an example placeholder", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#region");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.placeholder).toContain("chr3");
        });

        it("has a full-region checkbox that starts unchecked and disabled", () => {
            const doc = loadTemplate();
            const checkbox =
                doc.querySelector<HTMLInputElement>("#full-region");
            expect(checkbox).not.toBeNull();
            expect(checkbox?.type).toBe("checkbox");
            expect(checkbox?.checked).toBe(false);
            expect(checkbox?.disabled).toBe(true);
        });
    });

    describe("output file section", () => {
        it("has an output-file-input custom element", () => {
            const doc = loadTemplate();
            const el = doc.querySelector("output-file-input#output-source");
            expect(el).not.toBeNull();
        });
    });

    describe("summary section", () => {
        it("has a file-summary element with placeholder text", () => {
            const doc = loadTemplate();
            const summary = doc.querySelector("#file-summary");
            expect(summary).not.toBeNull();
            expect(summary?.textContent).toContain("Select files");
        });
    });

    describe("generate button", () => {
        it("is present and starts disabled", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-generate");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
            expect(btn?.disabled).toBe(true);
        });
    });

    describe("loading overlay", () => {
        it("is present and starts hidden", () => {
            const doc = loadTemplate();
            const overlay = doc.querySelector("#loading-overlay");
            expect(overlay).not.toBeNull();
            expect(overlay?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("results section", () => {
        it("is present and starts hidden", () => {
            const doc = loadTemplate();
            const section = doc.querySelector("#results-section");
            expect(section).not.toBeNull();
            expect(section?.classList.contains("hidden")).toBe(true);
        });

        it("has an empty results-content area", () => {
            const doc = loadTemplate();
            const content = doc.querySelector("#results-content");
            expect(content).not.toBeNull();
            expect(content?.textContent?.trim()).toBe("");
        });
    });

    describe("more-info dialog", () => {
        it("has a more-info-dialog element", () => {
            const doc = loadTemplate();
            const dialog = doc.querySelector("dialog#more-info-dialog");
            expect(dialog).not.toBeNull();
        });

        it("has a more-info-content area", () => {
            const doc = loadTemplate();
            const content = doc.querySelector("#more-info-content");
            expect(content).not.toBeNull();
        });

        it("has a close button", () => {
            const doc = loadTemplate();
            const btn =
                doc.querySelector<HTMLButtonElement>("#more-info-close");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });
    });
});
