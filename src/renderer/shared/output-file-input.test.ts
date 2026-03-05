// Tests for the output-file-input custom element.
// Verifies DOM structure, default state, Browse interaction, overwrite
// detection, showWarning/hideWarning helpers, and event dispatch.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputSelectedDetail } from "./output-file-input";
import { OutputFileInput } from "./output-file-input";

/**
 * Creates an OutputFileInput, appends it to the document body, and triggers
 * connectedCallback so the light-DOM is built.
 * Uses direct instantiation because vitest module caching prevents
 * customElements.define from running in this jsdom window.
 *
 * @returns The connected OutputFileInput element.
 */
function createElement(): OutputFileInput {
    const el = new OutputFileInput();
    document.body.appendChild(el);
    el.connectedCallback();
    return el;
}

describe("OutputFileInput", () => {
    /** Element under test. */
    let el: OutputFileInput;

    beforeEach(() => {
        el = createElement();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    // -------------------------------------------------------------------------
    // Rendered DOM
    // -------------------------------------------------------------------------

    describe("rendered DOM", () => {
        it("renders a file-input-row container", () => {
            const row = el.querySelector(".file-input-row");
            expect(row).not.toBeNull();
        });

        it("renders a readonly text input inside the file-input-row", () => {
            const input = el.querySelector<HTMLInputElement>(
                ".file-input-row input[type='text']",
            );
            expect(input).not.toBeNull();
            expect(input?.readOnly).toBe(true);
        });

        it("renders a Browse button", () => {
            const btn = el.querySelector<HTMLButtonElement>(
                ".file-input-row button",
            );
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
            expect(btn?.textContent?.trim()).toBe("Browse");
        });

        it("renders a visually-hidden label linked to the text input", () => {
            const label = el.querySelector<HTMLLabelElement>(
                "label.visually-hidden",
            );
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(label).not.toBeNull();
            expect(label?.htmlFor).toBe(input?.id);
        });

        it("renders the warning paragraph hidden by default", () => {
            const warning = el.querySelector(".file-exists-warning");
            expect(warning).not.toBeNull();
            expect(warning?.classList.contains("hidden")).toBe(true);
        });

        it("renders the overwrite confirm label hidden by default", () => {
            const confirmLabel = el.querySelector(".overwrite-confirm");
            expect(confirmLabel).not.toBeNull();
            expect(confirmLabel?.classList.contains("hidden")).toBe(true);
        });

        it("renders an overwrite confirmation checkbox", () => {
            const checkbox = el.querySelector<HTMLInputElement>(
                '.overwrite-confirm input[type="checkbox"]',
            );
            expect(checkbox).not.toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // Default state
    // -------------------------------------------------------------------------

    describe("default state", () => {
        it("has an empty value", () => {
            expect(el.value).toBe("");
        });

        it("is not disabled", () => {
            expect(el.disabled).toBe(false);
        });

        it("requiresOverwrite is false", () => {
            expect(el.requiresOverwrite).toBe(false);
        });

        it("overwriteConfirmed is false", () => {
            expect(el.overwriteConfirmed).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // disabled property
    // -------------------------------------------------------------------------

    describe("disabled property", () => {
        it("disables the text input, Browse button, and checkbox", () => {
            el.disabled = true;
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            const btn = el.querySelector<HTMLButtonElement>("button");
            const checkbox = el.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            );
            expect(input?.disabled).toBe(true);
            expect(btn?.disabled).toBe(true);
            expect(checkbox?.disabled).toBe(true);
        });

        it("re-enables all interactive children when set to false", () => {
            el.disabled = true;
            el.disabled = false;
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            const btn = el.querySelector<HTMLButtonElement>("button");
            const checkbox = el.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            );
            expect(input?.disabled).toBe(false);
            expect(btn?.disabled).toBe(false);
            expect(checkbox?.disabled).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // showWarning / hideWarning
    // -------------------------------------------------------------------------

    describe("showWarning", () => {
        it("displays the warning paragraph with the supplied message", () => {
            el.showWarning("File already exists.", false);
            const warning = el.querySelector<HTMLParagraphElement>(
                ".file-exists-warning",
            );
            expect(warning?.classList.contains("hidden")).toBe(false);
            expect(warning?.textContent).toBe("File already exists.");
        });

        it("shows the confirm label when hideCheckbox is false", () => {
            el.showWarning("File already exists.", false);
            const confirmLabel = el.querySelector(".overwrite-confirm");
            expect(confirmLabel?.classList.contains("hidden")).toBe(false);
        });

        it("hides the confirm label when hideCheckbox is true", () => {
            el.showWarning("Path collision.", true);
            const confirmLabel = el.querySelector(".overwrite-confirm");
            expect(confirmLabel?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("hideWarning", () => {
        it("hides the warning paragraph and confirm label", () => {
            el.showWarning("Some warning.", false);
            el.hideWarning();
            const warning = el.querySelector(".file-exists-warning");
            const confirmLabel = el.querySelector(".overwrite-confirm");
            expect(warning?.classList.contains("hidden")).toBe(true);
            expect(confirmLabel?.classList.contains("hidden")).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Browse button — selectFileFn
    // -------------------------------------------------------------------------

    describe("Browse button", () => {
        it("does nothing when selectFileFn is null", () => {
            el.selectFileFn = null;
            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            expect(el.value).toBe("");
        });

        it("sets the value when a path is picked", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/output/result.bed");
            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(el.value).toBe("/output/result.bed"));
        });

        it("fires output-selected after a path is picked", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/output/result.bed");
            const handler = vi.fn();
            el.addEventListener("output-selected", handler);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
        });

        it("does not fire output-selected when dialog is cancelled", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue(null);
            const handler = vi.fn();
            el.addEventListener("output-selected", handler);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 20);
            });

            expect(handler).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // checkExistsFn — overwrite flow
    // -------------------------------------------------------------------------

    describe("checkExistsFn — overwrite flow", () => {
        it("sets requiresOverwrite to true when the file exists", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/out/existing.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(true);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(el.requiresOverwrite).toBe(true));
        });

        it("shows the warning and confirm label when file exists", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/out/existing.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(true);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() =>
                expect(
                    el
                        .querySelector(".file-exists-warning")
                        ?.classList.contains("hidden"),
                ).toBe(false),
            );
            expect(
                el
                    .querySelector(".overwrite-confirm")
                    ?.classList.contains("hidden"),
            ).toBe(false);
        });

        it("leaves requiresOverwrite false when the file does not exist", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/out/new.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(false);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(el.value).toBe("/out/new.bed"));

            expect(el.requiresOverwrite).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Overwrite confirm checkbox
    // -------------------------------------------------------------------------

    describe("overwrite confirm checkbox", () => {
        it("overwriteConfirmed reflects the checkbox checked state", async () => {
            // First, trigger the overwrite flow so the checkbox is visible.
            el.selectFileFn = vi.fn().mockResolvedValue("/out/existing.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(true);
            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(el.requiresOverwrite).toBe(true));

            const checkbox = el.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            );
            expect(el.overwriteConfirmed).toBe(false);

            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("change"));
            }
            expect(el.overwriteConfirmed).toBe(true);
        });

        it("fires overwrite-confirmed when the checkbox changes", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/out/existing.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(true);
            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(el.requiresOverwrite).toBe(true));

            const handler = vi.fn();
            el.addEventListener("overwrite-confirmed", handler);

            const checkbox = el.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            );
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("change"));
            }

            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    // -------------------------------------------------------------------------
    // output-selected event detail
    // -------------------------------------------------------------------------

    describe("output-selected event detail", () => {
        it("includes value, requiresOverwrite, and overwriteConfirmed", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/out/new.bed");
            el.checkExistsFn = vi.fn().mockResolvedValue(false);

            const handler = vi.fn();
            el.addEventListener("output-selected", handler);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

            const detail = handler.mock.calls[0][0]
                .detail as OutputSelectedDetail;
            expect(detail.value).toBe("/out/new.bed");
            expect(detail.requiresOverwrite).toBe(false);
            expect(detail.overwriteConfirmed).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // connectedCallback idempotency
    // -------------------------------------------------------------------------

    describe("connectedCallback idempotency", () => {
        it("does not duplicate DOM when called multiple times", () => {
            el.connectedCallback();
            el.connectedCallback();
            const rows = el.querySelectorAll(".file-input-row");
            const warnings = el.querySelectorAll(".file-exists-warning");
            expect(rows).toHaveLength(1);
            expect(warnings).toHaveLength(1);
        });
    });
});
