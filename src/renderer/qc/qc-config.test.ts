// Tests for qc-config.html template structure and default form state.
// Uses jsdom to parse the HTML and verify DOM elements without a browser.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the qc-config.html template and injects it into the jsdom document body.
 * Returns the document for querying.
 *
 * @returns The document with the qc-config.html content loaded.
 */
function loadTemplate(): Document {
    const htmlPath = join(import.meta.dirname, "qc-config.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
    return document;
}

describe("qc-config.html", () => {
    describe("form inputs", () => {
        it("has a BAM path text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#bam-path");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.readOnly).toBe(true);
        });

        it("has source-type radios with file checked by default", () => {
            const doc = loadTemplate();
            const radios = doc.querySelectorAll<HTMLInputElement>(
                'input[name="source-type"]',
            );
            expect(radios).toHaveLength(2);
            const fileRadio = doc.querySelector<HTMLInputElement>(
                'input[name="source-type"][value="file"]',
            );
            const urlRadio = doc.querySelector<HTMLInputElement>(
                'input[name="source-type"][value="url"]',
            );
            expect(fileRadio?.checked).toBe(true);
            expect(urlRadio?.checked).toBe(false);
        });

        it("has a modification filter text input", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#mod-filter");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
        });

        it("has a region text input with placeholder showing both formats", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#region");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
            expect(input?.placeholder).toContain("chr3");
            expect(input?.placeholder).toContain("chrI:1000-50000");
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

        it("has a sample-fraction number input defaulting to 0.1", () => {
            const doc = loadTemplate();
            const input =
                doc.querySelector<HTMLInputElement>("#sample-fraction");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("number");
            expect(input?.value).toBe("0.1");
        });

        it("has a window-size number input defaulting to 300", () => {
            const doc = loadTemplate();
            const input = doc.querySelector<HTMLInputElement>("#window-size");
            expect(input).not.toBeNull();
            expect(input?.type).toBe("number");
            expect(input?.value).toBe("300");
        });
    });

    describe("read length dropdown", () => {
        it("has 5 options", () => {
            const doc = loadTemplate();
            const select = doc.querySelector<HTMLSelectElement>(
                "#read-length-granularity",
            );
            expect(select).not.toBeNull();
            const options = select?.querySelectorAll("option");
            expect(options).toHaveLength(5);
        });

        it('has option values ["1", "10", "100", "1000", "10000"]', () => {
            const doc = loadTemplate();
            const options = doc.querySelectorAll<HTMLOptionElement>(
                "#read-length-granularity option",
            );
            const values = Array.from(options).map((o) => o.value);
            expect(values).toEqual(["1", "10", "100", "1000", "10000"]);
        });

        it("defaults to 1000 (coarse)", () => {
            const doc = loadTemplate();
            const select = doc.querySelector<HTMLSelectElement>(
                "#read-length-granularity",
            );
            expect(select?.value).toBe("1000");
        });
    });

    describe("buttons", () => {
        it("has a back button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-back");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a browse button", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-browse");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
        });

        it("has a generate button that starts disabled", () => {
            const doc = loadTemplate();
            const btn = doc.querySelector<HTMLButtonElement>("#btn-generate");
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
});
