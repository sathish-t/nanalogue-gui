// @vitest-environment jsdom

/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekResult } from "../../lib/types";

vi.mock("../shared/apply-font-size", () => ({ applyFontSize: vi.fn() }));
vi.mock("../shared/bam-resource-input", () => ({}));
vi.mock("../shared/output-file-input", () => ({}));

const peekResult: PeekResult = {
    contigs: ["chr1"],
    totalContigs: 1,
    modifications: ["T+a"],
    allContigs: { chr1: 10_000 },
};

/** Loads the real Locate form handlers against the HTML template and mocked preload API. */
async function loadLocateHandlers(api: Record<string, unknown>) {
    document.documentElement.innerHTML = readFileSync(
        join(import.meta.dirname, "locate-config.html"),
        "utf-8",
    );
    const bam = document.getElementById("bam-source") as HTMLElement & {
        value: string;
        disabled: boolean;
    };
    Object.assign(bam, { value: "/reads.bam", disabled: false });
    const output = document.getElementById("output-source") as HTMLElement & {
        value: string;
        disabled: boolean;
    };
    Object.assign(output, {
        value: "/output.bed",
        disabled: false,
        isValid: true,
        requiresOverwrite: false,
        overwriteConfirmed: false,
        checkCurrentFileExists: vi.fn().mockResolvedValue(undefined),
        showWarning: vi.fn(),
        hideWarning: vi.fn(),
    });
    Object.defineProperty(window, "api", { configurable: true, value: api });
    await import("./locate-config");
    return { bam, output };
}

describe("Locate config form handlers", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("alert", vi.fn());
    });

    it("keeps a newer read-ID selection when an older picker is cancelled late", async () => {
        let cancelFirstPicker: (() => void) | undefined;
        const locatePickReadIds = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<null>((resolve) => {
                        cancelFirstPicker = () => resolve(null);
                    }),
            )
            .mockResolvedValueOnce("/newer-ids.txt");
        const api = {
            locatePickBam: vi.fn(),
            locatePickReadIds,
            locatePickOutput: vi.fn(),
            locateCheckFileExists: vi.fn(),
            locateCountReadIds: vi.fn().mockResolvedValue(23),
            locateGenerateBed: vi.fn(),
            peekBam: vi.fn().mockResolvedValue(peekResult),
            locateGoBack: vi.fn(),
        };
        await loadLocateHandlers(api);
        const browse = document.getElementById(
            "btn-browse-read-ids",
        ) as HTMLButtonElement;
        browse.click();
        browse.click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("read-id-path") as HTMLInputElement)
                    .value,
            ).toBe("/newer-ids.txt"),
        );
        cancelFirstPicker?.();
        await Promise.resolve();

        expect(
            (document.getElementById("read-id-path") as HTMLInputElement).value,
        ).toBe("/newer-ids.txt");
        expect(document.getElementById("file-summary")?.textContent).toContain(
            "23 read IDs",
        );
    });

    it("does not validate a new BAM against old metadata while its peek is pending", async () => {
        let resolvePeek: ((value: PeekResult) => void) | undefined;
        const api = {
            locatePickBam: vi.fn(),
            locatePickReadIds: vi.fn().mockResolvedValue("/ids.txt"),
            locatePickOutput: vi.fn(),
            locateCheckFileExists: vi.fn(),
            locateCountReadIds: vi.fn().mockResolvedValue(4),
            locateGenerateBed: vi.fn().mockResolvedValue({
                totalIds: 4,
                found: 4,
                bedEntries: 4,
                notFound: 0,
                unmapped: 0,
            }),
            peekBam: vi
                .fn()
                .mockResolvedValueOnce(peekResult)
                .mockImplementationOnce(
                    () =>
                        new Promise<PeekResult>((resolve) => {
                            resolvePeek = resolve;
                        }),
                ),
            locateGoBack: vi.fn(),
        };
        const { bam } = await loadLocateHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", { detail: { value: bam.value } }),
        );
        await vi.waitFor(() =>
            expect(
                document.getElementById("file-summary")?.textContent,
            ).toContain("chr1"),
        );
        (
            document.getElementById("btn-browse-read-ids") as HTMLButtonElement
        ).click();
        await vi.waitFor(() =>
            expect(
                document.getElementById("file-summary")?.textContent,
            ).toContain("4 read IDs"),
        );

        bam.value = "/newer.bam";
        bam.dispatchEvent(
            new CustomEvent("bam-selected", { detail: { value: bam.value } }),
        );
        (document.getElementById("region") as HTMLInputElement).value =
            "chr2:100-900";
        (document.getElementById("btn-generate") as HTMLButtonElement).click();
        expect(api.locateGenerateBed).toHaveBeenCalledWith({
            bamPath: "/newer.bam",
            readIdPath: "/ids.txt",
            outputPath: "/output.bed",
            overwriteConfirmed: false,
            region: "chr2:100-900",
            fullRegion: false,
        });
        expect(alert).not.toHaveBeenCalled();
        expect(
            document.getElementById("file-summary")?.textContent,
        ).not.toContain("chr1");
        expect(document.getElementById("file-summary")?.textContent).toContain(
            "4 read IDs",
        );

        resolvePeek?.({
            ...peekResult,
            contigs: ["chr2"],
            allContigs: { chr2: 20_000 },
        });
        await vi.waitFor(() =>
            expect(
                document.getElementById("file-summary")?.textContent,
            ).toContain("chr2"),
        );
    });

    it("submits current form values, renders results, and restores controls", async () => {
        const result = {
            totalIds: 4,
            found: 3,
            bedEntries: 2,
            notFound: 1,
            unmapped: 1,
        };
        let finishGeneration: ((value: typeof result) => void) | undefined;
        const locateGenerateBed = vi.fn(
            () =>
                new Promise<typeof result>((resolve) => {
                    finishGeneration = resolve;
                }),
        );
        const api = {
            locatePickBam: vi.fn(),
            locatePickReadIds: vi.fn().mockResolvedValue("/ids.txt"),
            locatePickOutput: vi.fn(),
            locateCheckFileExists: vi.fn(),
            locateCountReadIds: vi.fn().mockResolvedValue(4),
            locateGenerateBed,
            peekBam: vi.fn().mockResolvedValue(peekResult),
            locateGoBack: vi.fn(),
        };
        const { bam, output } = await loadLocateHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: "/reads.bam" },
            }),
        );
        (
            document.getElementById("btn-browse-read-ids") as HTMLButtonElement
        ).click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("btn-generate") as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        const region = document.getElementById("region") as HTMLInputElement;
        region.value = "chr1:0-20000";
        region.dispatchEvent(new Event("input"));
        (document.getElementById("btn-generate") as HTMLButtonElement).click();
        expect(locateGenerateBed).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining("Invalid region"),
        );
        region.value = "chr1:100-900";
        (document.getElementById("btn-generate") as HTMLButtonElement).click();
        await vi.waitFor(() =>
            expect(locateGenerateBed).toHaveBeenCalledOnce(),
        );
        expect(bam.disabled).toBe(true);
        expect(output.disabled).toBe(true);
        expect(
            (
                document.getElementById(
                    "btn-browse-read-ids",
                ) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        expect(
            document.getElementById("loading-overlay")?.classList,
        ).not.toContain("hidden");

        expect(locateGenerateBed).toHaveBeenCalledWith({
            bamPath: "/reads.bam",
            readIdPath: "/ids.txt",
            outputPath: "/output.bed",
            overwriteConfirmed: false,
            region: "chr1:100-900",
            fullRegion: false,
        });
        finishGeneration?.(result);
        await vi.waitFor(() =>
            expect(
                document.getElementById("results-section")?.classList,
            ).not.toContain("hidden"),
        );
        expect(
            document.getElementById("results-content")?.textContent,
        ).toContain("Generated BED file with 2 entries");
        expect(
            document.getElementById("results-content")?.textContent,
        ).toContain("1 read ID not found, 1 unmapped");
        expect(bam.disabled).toBe(false);
        expect(output.disabled).toBe(false);
        expect(
            (document.getElementById("btn-back") as HTMLButtonElement).disabled,
        ).toBe(false);
        expect(
            (
                document.getElementById(
                    "btn-browse-read-ids",
                ) as HTMLButtonElement
            ).disabled,
        ).toBe(false);
        expect(
            (document.getElementById("btn-generate") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
    });

    it("restores controls when BED generation rejects", async () => {
        const api = {
            locatePickBam: vi.fn(),
            locatePickReadIds: vi.fn().mockResolvedValue("/ids.txt"),
            locatePickOutput: vi.fn(),
            locateCheckFileExists: vi.fn(),
            locateCountReadIds: vi.fn().mockResolvedValue(4),
            locateGenerateBed: vi
                .fn()
                .mockRejectedValue(new Error("disk full")),
            peekBam: vi.fn().mockResolvedValue(peekResult),
            locateGoBack: vi.fn(),
        };
        const { bam, output } = await loadLocateHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: "/reads.bam" },
            }),
        );
        (
            document.getElementById("btn-browse-read-ids") as HTMLButtonElement
        ).click();
        await vi.waitFor(() =>
            expect(
                (document.getElementById("btn-generate") as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        (document.getElementById("btn-generate") as HTMLButtonElement).click();

        await vi.waitFor(() =>
            expect(
                document.getElementById("loading-overlay")?.classList,
            ).toContain("hidden"),
        );
        expect(bam.disabled).toBe(false);
        expect(output.disabled).toBe(false);
        expect(
            (document.getElementById("btn-generate") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining("disk full"),
        );
    });
});
