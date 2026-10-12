// @vitest-environment jsdom

/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekResult } from "../../lib/types";

vi.mock("../shared/apply-font-size", () => ({ applyFontSize: vi.fn() }));
vi.mock("../shared/bam-resource-input", () => ({}));
vi.mock("../shared/mod-filter-input", () => ({}));
vi.mock("../shared/output-file-input", () => ({}));
vi.mock("../shared/window-size-input", () => ({}));

const peekResult: PeekResult = {
    contigs: ["chr1"],
    totalContigs: 1,
    modifications: ["T+a"],
    allContigs: { chr1: 10_000 },
};

/** Loads the real Swipe form handlers against the HTML template and mocked preload API. */
async function loadSwipeHandlers(api: Record<string, unknown>) {
    document.documentElement.innerHTML = readFileSync(
        join(import.meta.dirname, "swipe-config.html"),
        "utf-8",
    );
    const bam = document.getElementById("bam-source") as HTMLElement & {
        value: string;
        isUrl: boolean;
    };
    Object.assign(bam, { value: "/reads.bam", isUrl: false });
    Object.assign(document.getElementById("mod-filter") as HTMLElement, {
        tag: "T+a",
        modStrand: "bc",
        isValid: true,
        showValidation: false,
        autoPopulate: vi.fn(),
    });
    Object.assign(document.getElementById("window-size") as HTMLElement, {
        value: 200,
        isValid: true,
    });
    const output = document.getElementById("output-source") as HTMLElement & {
        value: string;
    };
    Object.assign(output, {
        value: "/output.bed",
        isValid: true,
        requiresOverwrite: false,
        overwriteConfirmed: false,
        showWarning: vi.fn(),
        hideWarning: vi.fn(),
    });
    Object.defineProperty(window, "api", { configurable: true, value: api });
    await import("./swipe-config");
    return { bam, output };
}

describe("Swipe config form handlers", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("alert", vi.fn());
    });

    it("keeps a newer BED selection when an older picker is cancelled late", async () => {
        let cancelFirstPicker: (() => void) | undefined;
        const swipePickBed = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<null>((resolve) => {
                        cancelFirstPicker = () => resolve(null);
                    }),
            )
            .mockResolvedValueOnce("/newer.bed");
        const api = {
            swipePickBam: vi.fn(),
            swipePickBed,
            swipePickOutput: vi.fn(),
            swipeCountBedLines: vi.fn().mockResolvedValue(17),
            swipeCheckFileExists: vi.fn(),
            peekBam: vi.fn().mockResolvedValue(peekResult),
            swipeStart: vi.fn(),
            swipeGoBack: vi.fn(),
        };
        await loadSwipeHandlers(api);
        const browse = document.getElementById(
            "btn-browse-bed",
        ) as HTMLButtonElement;
        browse.click();
        browse.click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("bed-path") as HTMLInputElement).value,
            ).toBe("/newer.bed"),
        );
        cancelFirstPicker?.();
        await Promise.resolve();

        expect(
            (document.getElementById("bed-path") as HTMLInputElement).value,
        ).toBe("/newer.bed");
        expect(document.getElementById("file-summary")?.textContent).toContain(
            "17 data lines",
        );
    });

    it("submits current form values and restores controls after a rejected launch", async () => {
        let rejectLaunch:
            | ((result: { success: false; reason: string }) => void)
            | undefined;
        const swipeStart = vi.fn(
            () =>
                new Promise<{ success: false; reason: string }>((resolve) => {
                    rejectLaunch = resolve;
                }),
        );
        const api = {
            swipePickBam: vi.fn(),
            swipePickBed: vi.fn().mockResolvedValue("/regions.bed"),
            swipePickOutput: vi.fn(),
            swipeCountBedLines: vi.fn().mockResolvedValue(2),
            swipeCheckFileExists: vi.fn(),
            peekBam: vi.fn().mockResolvedValue(peekResult),
            swipeStart,
            swipeGoBack: vi.fn(),
        };
        const { bam } = await loadSwipeHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: "/reads.bam", isUrl: false },
            }),
        );
        (
            document.getElementById("btn-browse-bed") as HTMLButtonElement
        ).click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("btn-start") as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        (document.getElementById("btn-start") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(swipeStart).toHaveBeenCalledOnce());
        expect(
            (document.getElementById("btn-start") as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        expect(
            (document.getElementById("btn-back") as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(
            document.getElementById("loading-overlay")?.classList,
        ).not.toContain("hidden");

        expect(swipeStart).toHaveBeenCalledWith(
            expect.objectContaining({
                bamPath: "/reads.bam",
                bedPath: "/regions.bed",
                outputPath: "/output.bed",
                modTag: "T+a",
                regionExpansion: 1000,
            }),
        );
        rejectLaunch?.({ success: false, reason: "BED changed" });
        await vi.waitFor(() =>
            expect(
                document.getElementById("loading-overlay")?.classList,
            ).toContain("hidden"),
        );
        expect(
            (document.getElementById("btn-back") as HTMLButtonElement).disabled,
        ).toBe(false);
        expect(
            (document.getElementById("btn-start") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining("BED changed"),
        );
    });

    it("restores controls when the launch promise rejects", async () => {
        const api = {
            swipePickBam: vi.fn(),
            swipePickBed: vi.fn().mockResolvedValue("/regions.bed"),
            swipePickOutput: vi.fn(),
            swipeCountBedLines: vi.fn().mockResolvedValue(2),
            swipeCheckFileExists: vi.fn(),
            peekBam: vi.fn().mockResolvedValue(peekResult),
            swipeStart: vi.fn().mockRejectedValue(new Error("session crashed")),
            swipeGoBack: vi.fn(),
        };
        const { bam } = await loadSwipeHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: "/reads.bam", isUrl: false },
            }),
        );
        (
            document.getElementById("btn-browse-bed") as HTMLButtonElement
        ).click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("btn-start") as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        (document.getElementById("btn-start") as HTMLButtonElement).click();

        await vi.waitFor(() =>
            expect(
                document.getElementById("loading-overlay")?.classList,
            ).toContain("hidden"),
        );
        expect(
            (document.getElementById("btn-start") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
        expect(
            (document.getElementById("btn-back") as HTMLButtonElement).disabled,
        ).toBe(false);
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining("session crashed"),
        );
    });
});
