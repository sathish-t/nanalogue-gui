// Tests for the local BAM file input custom element.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvingFn } from "../../test-helpers";
import { BamResourceInput } from "./bam-resource-input";

/**
 * Creates and connects a local BAM file input.
 *
 * @returns The connected BAM file input.
 */
function createElement(): BamResourceInput {
    const element = new BamResourceInput();
    document.body.appendChild(element);
    element.connectedCallback();
    return element;
}

describe("BamResourceInput", () => {
    let element: BamResourceInput;

    beforeEach(() => {
        element = createElement();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders only a read-only path input and Browse button", () => {
        const input =
            element.querySelector<HTMLInputElement>('input[type="text"]');
        const button = element.querySelector<HTMLButtonElement>("button");

        expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(0);
        expect(input?.readOnly).toBe(true);
        expect(input?.placeholder).toBe("Select BAM/CRAM file");
        expect(button?.type).toBe("button");
        expect(button?.textContent).toBe("Browse");
    });

    it("gets and sets the selected path", () => {
        element.value = "/path/to/file.bam";
        expect(element.value).toBe("/path/to/file.bam");
    });

    it("disables and re-enables the path input and Browse button", () => {
        const input =
            element.querySelector<HTMLInputElement>('input[type="text"]');
        const button = element.querySelector<HTMLButtonElement>("button");

        element.disabled = true;
        expect(element.disabled).toBe(true);
        expect(input?.disabled).toBe(true);
        expect(button?.disabled).toBe(true);

        element.disabled = false;
        expect(element.disabled).toBe(false);
        expect(input?.disabled).toBe(false);
        expect(button?.disabled).toBe(false);
    });

    it("sets the path and emits bam-selected after file selection", async () => {
        element.selectFileFn = resolvingFn("/picked/file.bam");
        const handler = vi.fn();
        element.addEventListener("bam-selected", handler);

        element.querySelector<HTMLButtonElement>("button")?.click();
        await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

        expect(element.value).toBe("/picked/file.bam");
        expect(handler.mock.calls[0][0].detail).toEqual({
            value: "/picked/file.bam",
        });
    });

    it("does not emit when file selection is cancelled", async () => {
        element.selectFileFn = resolvingFn(null);
        const handler = vi.fn();
        element.addEventListener("bam-selected", handler);

        element.querySelector<HTMLButtonElement>("button")?.click();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(handler).not.toHaveBeenCalled();
        expect(element.value).toBe("");
    });

    it("does nothing when no file selector is configured", () => {
        element.querySelector<HTMLButtonElement>("button")?.click();
        expect(element.value).toBe("");
    });

    it("does not duplicate its DOM when reconnected", () => {
        element.connectedCallback();
        expect(element.querySelectorAll('input[type="text"]')).toHaveLength(1);
        expect(element.querySelectorAll("button")).toHaveLength(1);
    });
});
