// Tests for the mod-filter-input custom element.
// Verifies DOM structure, parsing, validation hints, autoPopulate, and events.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModFilterChangedDetail } from "./mod-filter-input";
import { ModFilterInput } from "./mod-filter-input";

/**
 * Creates a ModFilterInput, appends it to the body, and triggers connectedCallback.
 * Uses direct instantiation because vitest module caching prevents
 * customElements.define from running in this jsdom window.
 *
 * @returns The connected ModFilterInput element.
 */
function createElement(): ModFilterInput {
    const el = new ModFilterInput();
    document.body.appendChild(el);
    el.connectedCallback();
    return el;
}

describe("ModFilterInput", () => {
    /** Reference to the element under test. */
    let el: ModFilterInput;

    beforeEach(() => {
        el = createElement();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("rendered DOM", () => {
        it("renders a heading", () => {
            const heading = el.querySelector("h2");
            expect(heading).not.toBeNull();
            expect(heading?.textContent).toBe("Modification filter");
        });

        it("renders a text input with placeholder", () => {
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(input).not.toBeNull();
            expect(input?.placeholder).toBe("e.g. +T, -m, +a");
        });

        it("renders an accessible label linked to the input", () => {
            const label = el.querySelector<HTMLLabelElement>(
                "label.visually-hidden",
            );
            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            expect(label).not.toBeNull();
            expect(label?.textContent).toBe("Modification filter");
            expect(label?.htmlFor).toBe(input?.id);
            expect(input?.id).toBeTruthy();
        });

        it("renders a strand convention hint", () => {
            const hints = el.querySelectorAll("p.hint");
            const strandHint = Array.from(hints).find(
                (p) => !p.classList.contains("warning"),
            );
            expect(strandHint).not.toBeNull();
            expect(strandHint?.textContent).toContain("basecalled strand");
        });

        it("renders a validation hint that starts hidden", () => {
            const hint = el.querySelector("p.hint.warning");
            expect(hint).not.toBeNull();
            expect(hint?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("default state", () => {
        it("starts with empty value", () => {
            expect(el.value).toBe("");
        });

        it("starts invalid", () => {
            expect(el.isValid).toBe(false);
        });

        it("has undefined tag when empty", () => {
            expect(el.tag).toBeUndefined();
        });

        it("has undefined modStrand when empty", () => {
            expect(el.modStrand).toBeUndefined();
        });

        it("starts with showValidation false", () => {
            expect(el.showValidation).toBe(false);
        });
    });

    describe("value property", () => {
        it("gets and sets the text input value", () => {
            el.value = "+T";
            expect(el.value).toBe("+T");
        });
    });

    describe("parsing", () => {
        it("parses +T as tag=T, modStrand=bc", () => {
            el.value = "+T";
            expect(el.tag).toBe("T");
            expect(el.modStrand).toBe("bc");
            expect(el.isValid).toBe(true);
        });

        it("parses -m as tag=m, modStrand=bc_comp", () => {
            el.value = "-m";
            expect(el.tag).toBe("m");
            expect(el.modStrand).toBe("bc_comp");
            expect(el.isValid).toBe(true);
        });

        it("parses +a as tag=a, modStrand=bc", () => {
            el.value = "+a";
            expect(el.tag).toBe("a");
            expect(el.modStrand).toBe("bc");
            expect(el.isValid).toBe(true);
        });

        it("returns invalid for bare text without sign prefix", () => {
            el.value = "T";
            expect(el.isValid).toBe(false);
            expect(el.tag).toBeUndefined();
        });

        it("returns invalid for lone sign", () => {
            el.value = "+";
            expect(el.isValid).toBe(false);
            expect(el.tag).toBeUndefined();
        });

        it("returns invalid for empty string", () => {
            el.value = "";
            expect(el.isValid).toBe(false);
        });
    });

    describe("showValidation", () => {
        it("shows 'Required' hint when empty and validation enabled", () => {
            el.showValidation = true;
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(false);
            expect(hint?.textContent).toContain("Required");
        });

        it("shows 'Invalid format' hint when non-empty but invalid", () => {
            el.value = "T";
            el.showValidation = true;
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(false);
            expect(hint?.textContent).toContain("Invalid format");
        });

        it("hides hint when input is valid", () => {
            el.value = "+T";
            el.showValidation = true;
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(true);
        });

        it("hides hint when showValidation is false even if invalid", () => {
            el.value = "";
            el.showValidation = false;
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("autoPopulate", () => {
        it("sets value to first modification when current value is invalid", () => {
            el.autoPopulate(["+T", "-m"]);
            expect(el.value).toBe("+T");
            expect(el.isValid).toBe(true);
        });

        it("does not overwrite a valid value", () => {
            el.value = "-m";
            el.autoPopulate(["+T", "+a"]);
            expect(el.value).toBe("-m");
        });

        it("does nothing with empty modifications array", () => {
            el.autoPopulate([]);
            expect(el.value).toBe("");
        });

        it("fires mod-filter-changed event when populating", () => {
            const handler = vi.fn();
            el.addEventListener("mod-filter-changed", handler);
            el.autoPopulate(["+T"]);
            expect(handler).toHaveBeenCalledTimes(1);
            const detail = handler.mock.calls[0][0]
                .detail as ModFilterChangedDetail;
            expect(detail.tag).toBe("T");
            expect(detail.isValid).toBe(true);
        });

        it("does not fire event when modifications array is empty", () => {
            const handler = vi.fn();
            el.addEventListener("mod-filter-changed", handler);
            el.autoPopulate([]);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe("mod-filter-changed event", () => {
        it("fires on input with parsed detail", () => {
            const handler = vi.fn();
            el.addEventListener("mod-filter-changed", handler);

            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            if (input) {
                input.value = "+T";
                input.dispatchEvent(new Event("input"));
            }

            expect(handler).toHaveBeenCalledTimes(1);
            const detail = handler.mock.calls[0][0]
                .detail as ModFilterChangedDetail;
            expect(detail.tag).toBe("T");
            expect(detail.modStrand).toBe("bc");
            expect(detail.isValid).toBe(true);
        });

        it("fires with undefined tag for invalid input", () => {
            const handler = vi.fn();
            el.addEventListener("mod-filter-changed", handler);

            const input =
                el.querySelector<HTMLInputElement>('input[type="text"]');
            if (input) {
                input.value = "bad";
                input.dispatchEvent(new Event("input"));
            }

            expect(handler).toHaveBeenCalledTimes(1);
            const detail = handler.mock.calls[0][0]
                .detail as ModFilterChangedDetail;
            expect(detail.tag).toBeUndefined();
            expect(detail.isValid).toBe(false);
        });
    });

    describe("connectedCallback idempotency", () => {
        it("does not duplicate DOM on repeated connectedCallback calls", () => {
            el.connectedCallback();
            const headings = el.querySelectorAll("h2");
            expect(headings).toHaveLength(1);
            const inputs = el.querySelectorAll('input[type="text"]');
            expect(inputs).toHaveLength(1);
        });
    });
});
