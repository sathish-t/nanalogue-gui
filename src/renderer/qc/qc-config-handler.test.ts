// @vitest-environment jsdom

/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekResult, QCConfig } from "../../lib/types";

vi.mock("../shared/apply-font-size", () => ({ applyFontSize: vi.fn() }));
vi.mock("../shared/bam-resource-input", () => ({}));
vi.mock("../shared/mod-filter-input", () => ({}));
vi.mock("../shared/window-size-input", () => ({}));

interface TestBamInput extends HTMLElement {
    value: string;
    isUrl: boolean;
    disabled: boolean;
}

interface TestModFilter extends HTMLElement {
    tag: string;
    modStrand: "bc" | "bc_comp";
    isValid: boolean;
    showValidation: boolean;
    autoPopulate: ReturnType<typeof vi.fn>;
}

const peekResult: PeekResult = {
    contigs: ["chr1"],
    totalContigs: 1,
    modifications: ["T+a"],
    allContigs: { chr1: 10_000 },
};

/** Loads the real QC form handlers against the HTML template and mocked preload API. */
async function loadQCHandlers(api: Record<string, unknown>) {
    document.documentElement.innerHTML = readFileSync(
        join(import.meta.dirname, "qc-config.html"),
        "utf-8",
    );
    const bam = document.getElementById("bam-source") as TestBamInput;
    Object.assign(bam, { value: "/reads.bam", isUrl: false, disabled: false });
    const mod = document.getElementById("mod-filter") as TestModFilter;
    Object.assign(mod, {
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
    Object.defineProperty(window, "api", { configurable: true, value: api });
    await import("./qc-config");
    return { bam, mod };
}

describe("QC config form handlers", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("alert", vi.fn());
    });

    it("submits the live form and removes its progress listener after completion", async () => {
        let resolveGeneration: (() => void) | undefined;
        let progress: ((source: string, count: number) => void) | undefined;
        const removeProgressListener = vi.fn();
        const generateQC = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveGeneration = resolve;
                }),
        );
        const api = {
            peekBam: vi.fn().mockResolvedValue(peekResult),
            generateQC,
            selectFile: vi.fn(),
            goBack: vi.fn(),
            locatePickReadIds: vi.fn(),
            locateCountReadIds: vi.fn(),
            onQCProgress: vi.fn((callback) => {
                progress = callback;
                return removeProgressListener;
            }),
        };
        const { bam } = await loadQCHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: bam.value, isUrl: false },
            }),
        );
        await vi.waitFor(() =>
            expect(
                document
                    .getElementById("btn-generate")
                    ?.hasAttribute("disabled"),
            ).toBe(false),
        );

        (document.getElementById("btn-generate") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(generateQC).toHaveBeenCalledOnce());
        expect(removeProgressListener).not.toHaveBeenCalled();
        expect(generateQC).toHaveBeenCalledWith(
            expect.objectContaining<Partial<QCConfig>>({
                bamPath: "/reads.bam",
                treatAsUrl: false,
                tag: "T+a",
                modStrand: "bc",
            }),
        );
        progress?.("windows", 12_345);
        expect(
            document.getElementById("progress-windows")?.textContent,
        ).toContain("12,345");
        expect(
            document.getElementById("loading-overlay")?.classList,
        ).not.toContain("hidden");

        resolveGeneration?.();
        await vi.waitFor(() =>
            expect(removeProgressListener).toHaveBeenCalledOnce(),
        );
    });

    it("removes progress and restores the form when generation rejects", async () => {
        const removeProgressListener = vi.fn();
        const api = {
            peekBam: vi.fn().mockResolvedValue(peekResult),
            generateQC: vi.fn().mockRejectedValue(new Error("worker stopped")),
            selectFile: vi.fn(),
            goBack: vi.fn(),
            locatePickReadIds: vi.fn(),
            locateCountReadIds: vi.fn(),
            onQCProgress: vi.fn(() => removeProgressListener),
        };
        const { bam } = await loadQCHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: bam.value, isUrl: false },
            }),
        );
        await vi.waitFor(() =>
            expect(
                (document.getElementById("btn-generate") as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        (document.getElementById("btn-generate") as HTMLButtonElement).click();

        await vi.waitFor(() =>
            expect(removeProgressListener).toHaveBeenCalledOnce(),
        );
        expect(document.getElementById("loading-overlay")?.classList).toContain(
            "hidden",
        );
        expect(
            (document.getElementById("btn-generate") as HTMLButtonElement)
                .disabled,
        ).toBe(false);
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining("worker stopped"),
        );
    });

    it("ignores a late peek completion after the source is cancelled", async () => {
        let resolvePeek: ((result: PeekResult) => void) | undefined;
        const api = {
            peekBam: vi.fn(
                () =>
                    new Promise<PeekResult>((resolve) => {
                        resolvePeek = resolve;
                    }),
            ),
            generateQC: vi.fn(),
            selectFile: vi.fn(),
            goBack: vi.fn(),
            locatePickReadIds: vi.fn(),
            locateCountReadIds: vi.fn(),
            onQCProgress: vi.fn(),
        };
        const { bam, mod } = await loadQCHandlers(api);
        bam.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: bam.value, isUrl: false },
            }),
        );
        expect(api.peekBam).toHaveBeenCalledWith("/reads.bam", false);
        expect(bam.disabled).toBe(true);
        bam.value = "";
        bam.dispatchEvent(new CustomEvent("source-type-changed"));
        resolvePeek?.(peekResult);
        await Promise.resolve();

        expect(mod.autoPopulate).not.toHaveBeenCalled();
        expect(
            document.getElementById("file-info-content")?.textContent,
        ).toContain("Will load upon BAM file specification");
        expect(
            (document.getElementById("btn-generate") as HTMLButtonElement)
                .disabled,
        ).toBe(true);
    });
});
