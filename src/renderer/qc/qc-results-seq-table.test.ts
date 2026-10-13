// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const rows = buildSequenceRows(11);
        rows[10].readId = "read-9";
        rows[10].sequence = "CZ";
        rows[10].baseSequence = "CT";
        const rendering = renderSeqTable(
            "seq-table-container",
            rows,
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

        // Start a selection before the later batch exists, then extend it across batches.
        (document.querySelectorAll("tbody tr")[8] as HTMLElement).click();
        frameCallbacks[0](0);
        await rendering;

        expect(document.querySelectorAll("tbody tr")).toHaveLength(11);
        const lastRow = document.querySelectorAll("tbody tr")[10];
        expect(lastRow.querySelector(".seq-read-id")?.textContent).toBe(
            "read-9",
        );
        expect(lastRow.querySelectorAll("td")[2].textContent).toBe("CT");
        lastRow.dispatchEvent(
            new MouseEvent("click", { bubbles: true, shiftKey: true }),
        );
        expect(document.querySelectorAll(".seq-selected")).toHaveLength(3);
        const copyButton = document.querySelector<HTMLButtonElement>(
            ".seq-toolbar button",
        );
        expect(copyButton?.textContent).toBe("Copy 2 selected read IDs");
        copyButton?.click();
        expect(writeText).toHaveBeenCalledWith("read-8\nread-9");
        clearButton?.click();
        expect(document.querySelectorAll(".seq-selected")).toHaveLength(0);
        expect(copyButton?.disabled).toBe(true);
    });

    it("preserves selection for retry when copying read IDs fails", async () => {
        const failure = new Error("Clipboard permission denied");
        const writeText = vi
            .fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await renderSeqTable(
            "seq-table-container",
            buildSequenceRows(1),
            undefined,
            undefined,
        );
        document.querySelector<HTMLElement>("tbody tr")?.click();
        const copyButton = document.querySelector<HTMLButtonElement>(
            ".seq-toolbar button",
        );
        copyButton?.click();
        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(
                "Failed to copy read IDs:",
                failure,
            ),
        );
        expect(document.querySelectorAll(".seq-selected")).toHaveLength(1);
        expect(copyButton?.disabled).toBe(false);
        copyButton?.click();
        expect(writeText.mock.calls).toEqual([["read-0"], ["read-0"]]);
    });
});
