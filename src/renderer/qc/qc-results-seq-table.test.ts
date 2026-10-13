// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeqTableRow } from "../../lib/types";
import { renderSeqTable } from "./qc-results-seq-table";

/**
 * Builds sequence rows for renderer batching tests.
 *
 * @param count - Number of synthetic sequence rows to create.
 * @returns Synthetic sequence rows with one base each.
 */
function buildSequenceRows(count: number): SeqTableRow[] {
    return Array.from({ length: count }, (_, index) => ({
        readId: `read-${index}`,
        sequence: "A",
        baseSequence: "A",
        qualities: [20],
        avgQuality: 20,
    }));
}

describe("renderSeqTable", () => {
    beforeEach(() => {
        // Minimal sequence-tab HTML used by the renderer.
        document.body.innerHTML = `
            <p class="seq-disclaimer"></p>
            <div id="seq-table-container"></div>
        `;
        vi.unstubAllGlobals();
    });

    it("yields between batches so Chromium can paint and process input", async () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal(
            "requestAnimationFrame",
            vi.fn((callback: FrameRequestCallback) => {
                frameCallbacks.push(callback);
                return frameCallbacks.length;
            }),
        );

        const rendering = renderSeqTable(
            "seq-table-container",
            buildSequenceRows(11),
            undefined,
            undefined,
        );

        expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
        expect(frameCallbacks).toHaveLength(1);
        const firstRow = document.querySelector("tbody tr") as HTMLElement;
        const clearButton = Array.from(
            document.querySelectorAll<HTMLButtonElement>(".seq-toolbar button"),
        ).find((button) => button.textContent === "Clear selection");
        firstRow.click();
        expect(clearButton?.disabled).toBe(false);
        clearButton?.click();
        expect(firstRow.classList.contains("seq-selected")).toBe(false);

        frameCallbacks[0](0);
        await rendering;

        expect(document.querySelectorAll("tbody tr")).toHaveLength(11);
    });
});
