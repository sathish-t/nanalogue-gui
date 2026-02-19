// Tests for the window-size-input custom element.
// Verifies DOM structure, value parsing, validation, and events.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowSizeChangedDetail } from "./window-size-input";
import { WindowSizeInput } from "./window-size-input";

/**
 * Creates a WindowSizeInput, appends it to the body, and triggers connectedCallback.
 * Uses direct instantiation because vitest module caching prevents
 * customElements.define from running in this jsdom window.
 *
 * @returns The connected WindowSizeInput element.
 */
function createElement(): WindowSizeInput {
    const el = new WindowSizeInput();
    document.body.appendChild(el);
    el.connectedCallback();
    return el;
}

describe("WindowSizeInput", () => {
    /** Reference to the element under test. */
    let el: WindowSizeInput;

    beforeEach(() => {
        el = createElement();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("rendered DOM", () => {
        it("renders a heading with optional annotation", () => {
            const heading = el.querySelector("h2");
            expect(heading).not.toBeNull();
            expect(heading?.textContent).toContain("Window size");
            const optional = heading?.querySelector(".optional");
            expect(optional?.textContent).toContain("for windowed density");
        });

        it("renders a number input with correct attributes", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            expect(input).not.toBeNull();
            expect(input?.value).toBe("300");
            expect(input?.min).toBe("2");
            expect(input?.max).toBe("10000");
            expect(input?.step).toBe("10");
        });

        it("renders an accessible label linked to the input", () => {
            const label = el.querySelector<HTMLLabelElement>(
                "label.visually-hidden",
            );
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            expect(label).not.toBeNull();
            expect(label?.textContent).toBe("Window size");
            expect(label?.htmlFor).toBe(input?.id);
            expect(input?.id).toBeTruthy();
        });

        it("renders a unit label", () => {
            const unit = el.querySelector(".unit");
            expect(unit).not.toBeNull();
            expect(unit?.textContent).toBe("bases of interest");
        });

        it("wraps input and unit in input-with-unit container", () => {
            const wrapper = el.querySelector(".input-with-unit");
            expect(wrapper).not.toBeNull();
            expect(
                wrapper?.querySelector('input[type="number"]'),
            ).not.toBeNull();
            expect(wrapper?.querySelector(".unit")).not.toBeNull();
        });

        it("renders a hint about bases of interest", () => {
            const hints = el.querySelectorAll("p.hint");
            const boiHint = Array.from(hints).find(
                (p) => !p.classList.contains("warning"),
            );
            expect(boiHint).not.toBeNull();
            expect(boiHint?.textContent).toContain("bases of interest");
        });

        it("renders a validation hint that starts hidden", () => {
            const hint = el.querySelector("p.hint.warning");
            expect(hint).not.toBeNull();
            expect(hint?.classList.contains("hidden")).toBe(true);
        });
    });

    describe("default state", () => {
        it("starts with value 300", () => {
            expect(el.value).toBe(300);
        });

        it("starts valid", () => {
            expect(el.isValid).toBe(true);
        });
    });

    describe("value property", () => {
        it("returns parsed integer from input", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "500";
            expect(el.value).toBe(500);
        });

        it("returns NaN for non-numeric input", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "";
            expect(el.value).toBeNaN();
        });
    });

    describe("isValid", () => {
        it("returns true for value within range", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "100";
            expect(el.isValid).toBe(true);
        });

        it("returns true for min boundary (2)", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "2";
            expect(el.isValid).toBe(true);
        });

        it("returns true for max boundary (10000)", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "10000";
            expect(el.isValid).toBe(true);
        });

        it("returns false for value below min", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "1";
            expect(el.isValid).toBe(false);
        });

        it("returns false for value above max", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "10001";
            expect(el.isValid).toBe(false);
        });

        it("returns false for empty input", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "";
            expect(el.isValid).toBe(false);
        });

        it("returns false for non-integer", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) input.value = "3.5";
            expect(el.isValid).toBe(false);
        });
    });

    describe("validation hint", () => {
        it("shows warning when value is out of range", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) {
                input.value = "1";
                input.dispatchEvent(new Event("input"));
            }
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(false);
            expect(hint?.textContent).toContain("between 2 and 10,000");
        });

        it("hides warning when value is valid", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) {
                input.value = "300";
                input.dispatchEvent(new Event("input"));
            }
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(true);
        });

        it("shows warning for empty input", () => {
            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) {
                input.value = "";
                input.dispatchEvent(new Event("input"));
            }
            const hint = el.querySelector("p.hint.warning");
            expect(hint?.classList.contains("hidden")).toBe(false);
        });
    });

    describe("window-size-changed event", () => {
        it("fires on input with parsed detail", () => {
            const handler = vi.fn();
            el.addEventListener("window-size-changed", handler);

            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) {
                input.value = "500";
                input.dispatchEvent(new Event("input"));
            }

            expect(handler).toHaveBeenCalledTimes(1);
            const detail = handler.mock.calls[0][0]
                .detail as WindowSizeChangedDetail;
            expect(detail.value).toBe(500);
            expect(detail.isValid).toBe(true);
        });

        it("fires with isValid false for out-of-range value", () => {
            const handler = vi.fn();
            el.addEventListener("window-size-changed", handler);

            const input = el.querySelector<HTMLInputElement>(
                'input[type="number"]',
            );
            if (input) {
                input.value = "1";
                input.dispatchEvent(new Event("input"));
            }

            expect(handler).toHaveBeenCalledTimes(1);
            const detail = handler.mock.calls[0][0]
                .detail as WindowSizeChangedDetail;
            expect(detail.value).toBe(1);
            expect(detail.isValid).toBe(false);
        });
    });

    describe("connectedCallback idempotency", () => {
        it("does not duplicate DOM on repeated connectedCallback calls", () => {
            el.connectedCallback();
            const headings = el.querySelectorAll("h2");
            expect(headings).toHaveLength(1);
            const inputs = el.querySelectorAll('input[type="number"]');
            expect(inputs).toHaveLength(1);
        });
    });
});
