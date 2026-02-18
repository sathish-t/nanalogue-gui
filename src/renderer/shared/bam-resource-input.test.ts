// Tests for the bam-resource-input custom element.
// Verifies DOM structure, default state, mode switching, and event dispatch.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BamResourceInput } from "./bam-resource-input";

/**
 * Creates a BamResourceInput, appends it to the body, and triggers connectedCallback.
 * Uses direct instantiation because vitest module caching prevents
 * customElements.define from running in this jsdom window.
 *
 * @returns The connected BamResourceInput element.
 */
function createElement(): BamResourceInput {
    const el = new BamResourceInput();
    document.body.appendChild(el);
    el.connectedCallback();
    return el;
}

describe("BamResourceInput", () => {
    /** Reference to the element under test. */
    let el: BamResourceInput;

    beforeEach(() => {
        el = createElement();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("rendered DOM", () => {
        it("renders two radio buttons in a source-toggle container", () => {
            const toggle = el.querySelector(".source-toggle");
            expect(toggle).not.toBeNull();
            const radios = toggle?.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            );
            expect(radios).toHaveLength(2);
        });

        it("has file radio checked by default", () => {
            const radios = el.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            );
            const fileRadio = Array.from(radios).find(
                (r) => r.value === "file",
            );
            const urlRadio = Array.from(radios).find((r) => r.value === "url");
            expect(fileRadio?.checked).toBe(true);
            expect(urlRadio?.checked).toBe(false);
        });

        it("renders a text input", () => {
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input).not.toBeNull();
            expect(input?.type).toBe("text");
        });

        it("renders a Browse button", () => {
            const btn = el.querySelector<HTMLButtonElement>("button");
            expect(btn).not.toBeNull();
            expect(btn?.type).toBe("button");
            expect(btn?.textContent).toBe("Browse");
        });

        it("renders an accessible label", () => {
            const label = el.querySelector("label.visually-hidden");
            expect(label).not.toBeNull();
            expect(label?.textContent).toBe("BAM path");
        });
    });

    describe("default state", () => {
        it("starts with empty value", () => {
            expect(el.value).toBe("");
        });

        it("starts in file mode (not URL)", () => {
            expect(el.isUrl).toBe(false);
        });

        it("starts not disabled", () => {
            expect(el.disabled).toBe(false);
        });

        it("has readonly text input in file mode", () => {
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input?.readOnly).toBe(true);
        });

        it("shows file placeholder by default", () => {
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input?.placeholder).toBe("Select BAM/CRAM file");
        });
    });

    describe("value property", () => {
        it("gets and sets the text input value", () => {
            el.value = "/path/to/file.bam";
            expect(el.value).toBe("/path/to/file.bam");
        });
    });

    describe("disabled property", () => {
        it("disables all interactive children", () => {
            el.disabled = true;
            const textInput =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            const btn = el.querySelector<HTMLButtonElement>("button");
            const radios = el.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            );
            expect(textInput?.disabled).toBe(true);
            expect(btn?.disabled).toBe(true);
            for (const radio of radios) {
                expect(radio.disabled).toBe(true);
            }
        });

        it("re-enables all interactive children", () => {
            el.disabled = true;
            el.disabled = false;
            const textInput =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            const btn = el.querySelector<HTMLButtonElement>("button");
            const radios = el.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            );
            expect(textInput?.disabled).toBe(false);
            expect(btn?.disabled).toBe(false);
            for (const radio of radios) {
                expect(radio.disabled).toBe(false);
            }
        });
    });

    describe("URL mode switching", () => {
        /**
         * Switches the element to URL mode by checking the URL radio.
         */
        function switchToUrlMode(): void {
            const urlRadio = Array.from(
                el.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
            ).find((r) => r.value === "url");
            if (urlRadio) {
                urlRadio.checked = true;
                urlRadio.dispatchEvent(new Event("change"));
            }
        }

        it("sets isUrl to true when URL radio is selected", () => {
            switchToUrlMode();
            expect(el.isUrl).toBe(true);
        });

        it("makes text input editable in URL mode", () => {
            switchToUrlMode();
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input?.readOnly).toBe(false);
        });

        it("hides Browse button in URL mode", () => {
            switchToUrlMode();
            const btn = el.querySelector<HTMLButtonElement>("button");
            expect(btn?.style.display).toBe("none");
        });

        it("updates placeholder in URL mode", () => {
            switchToUrlMode();
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input?.placeholder).toBe("Enter BAM/CRAM URL");
        });

        it("clears value on mode switch", () => {
            el.value = "/path/to/file.bam";
            switchToUrlMode();
            expect(el.value).toBe("");
        });

        it("dispatches source-type-changed event", () => {
            const handler = vi.fn();
            el.addEventListener("source-type-changed", handler);
            switchToUrlMode();
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe("Browse button", () => {
        it("does nothing when selectFileFn is null", () => {
            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            expect(el.value).toBe("");
        });

        it("sets value and fires bam-selected when file is picked", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue("/picked/file.bam");
            const handler = vi.fn();
            el.addEventListener("bam-selected", handler);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

            expect(el.value).toBe("/picked/file.bam");
            const detail = handler.mock.calls[0][0].detail;
            expect(detail.value).toBe("/picked/file.bam");
            expect(detail.isUrl).toBe(false);
        });

        it("does not fire bam-selected when file dialog is cancelled", async () => {
            el.selectFileFn = vi.fn().mockResolvedValue(null);
            const handler = vi.fn();
            el.addEventListener("bam-selected", handler);

            const btn = el.querySelector<HTMLButtonElement>("button");
            btn?.click();
            // Allow the promise to settle
            await new Promise((resolve) => {
                setTimeout(resolve, 10);
            });
            expect(handler).not.toHaveBeenCalled();
            expect(el.value).toBe("");
        });
    });

    describe("connectedCallback idempotency", () => {
        it("does not duplicate DOM on repeated connectedCallback calls", () => {
            el.connectedCallback();
            const radios = el.querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            );
            expect(radios).toHaveLength(2);
            const buttons = el.querySelectorAll("button");
            expect(buttons).toHaveLength(1);
        });
    });
});
