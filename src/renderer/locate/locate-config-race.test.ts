// Regression tests for stale async metadata responses in the Locate config renderer.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PeekResult } from "../../lib/types";
import { suppressConsoleError } from "../../test-helpers";
import type { BamResourceInput } from "../shared/bam-resource-input";

/** A manually settled promise for deterministic out-of-order response tests. */
interface DeferredPromise<T> {
    /** Promise passed to the mocked preload API. */
    promise: Promise<T>;
    /** Resolves the promise with a value. */
    resolve: (value: T) => void;
    /** Rejects the promise with an error. */
    reject: (error: unknown) => void;
}

/**
 * Creates a promise whose completion order is controlled by the test.
 *
 * @returns A promise and its external resolve/reject functions.
 */
function createDeferredPromise<T>(): DeferredPromise<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/**
 * Creates BAM metadata with an identifying contig and modification.
 *
 * @param name - Identifier included in the metadata.
 * @returns Peek metadata for the named BAM.
 */
function createPeekResult(name: string): PeekResult {
    return {
        contigs: [name],
        totalContigs: 1,
        modifications: [`+${name}`],
        allContigs: { [name]: 1_000 },
    };
}

/** Allows async DOM event handlers to pass their await boundaries. */
async function settleEventHandlers(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Dispatches the real event consumed by the Locate BAM selection handler.
 *
 * @param path - BAM path included in the selection event.
 */
function selectBam(path: string): void {
    const bamSource = document.getElementById("bam-source") as BamResourceInput;
    bamSource.value = path;
    bamSource.dispatchEvent(
        new CustomEvent("bam-selected", {
            detail: { value: path },
        }),
    );
}

const stalePeek = createDeferredPromise<PeekResult>();
const staleFailedPeek = createDeferredPromise<PeekResult>();
const staleReadIdCount = createDeferredPromise<number>();
const staleSuccessfulReadIdCount = createDeferredPromise<number>();
const currentPeek = createPeekResult("current");
const pickedReadIdPaths: string[] = [];
const samePathPeekResponses: Array<Promise<PeekResult>> = [];
const samePathReadIdCountResponses: Array<Promise<number>> = [];

beforeAll(async () => {
    const html = readFileSync(
        join(import.meta.dirname, "locate-config.html"),
        "utf-8",
    );
    document.documentElement.innerHTML = html;

    Object.defineProperty(window, "api", {
        configurable: true,
        value: {
            locatePickBam: vi.fn(),
            locatePickReadIds: vi.fn(
                async () => pickedReadIdPaths.shift() ?? null,
            ),
            locatePickOutput: vi.fn(),
            locateCheckFileExists: vi.fn(),
            locateCountReadIds: vi.fn((path: string) => {
                if (path === "stale.txt") return staleReadIdCount.promise;
                if (path === "stale-success.txt") {
                    return staleSuccessfulReadIdCount.promise;
                }
                if (path === "same-path.txt") {
                    return (
                        samePathReadIdCountResponses.shift() ??
                        Promise.resolve(22)
                    );
                }
                return Promise.resolve(22);
            }),
            locateGenerateBed: vi.fn(),
            peekBam: vi.fn((path: string) => {
                if (path === "stale.bam") return stalePeek.promise;
                if (path === "stale-failure.bam") {
                    return staleFailedPeek.promise;
                }
                if (path === "same-path.bam") {
                    return (
                        samePathPeekResponses.shift() ??
                        Promise.resolve(currentPeek)
                    );
                }
                return Promise.resolve(currentPeek);
            }),
            locateGoBack: vi.fn(),
        },
    });

    await import("./locate-config");
});

describe("Locate config metadata request ordering", () => {
    it("does not expose a stale successful BAM peek after a later refresh", async () => {
        selectBam("stale.bam");
        selectBam("current.bam");
        await settleEventHandlers();

        stalePeek.resolve(createPeekResult("stale"));
        await settleEventHandlers();

        pickedReadIdPaths.push("current.txt");
        document.getElementById("btn-browse-read-ids")?.click();
        await settleEventHandlers();

        expect(document.getElementById("file-summary")?.textContent).toContain(
            "current",
        );
        expect(
            document.getElementById("file-summary")?.textContent,
        ).not.toContain("stale");
    });

    it("does not clear a current BAM peek when a stale request fails", async () => {
        const consoleError = suppressConsoleError();
        try {
            selectBam("stale-failure.bam");
            selectBam("current.bam");
            await settleEventHandlers();

            staleFailedPeek.reject(new Error("stale peek failed"));
            await settleEventHandlers();

            pickedReadIdPaths.push("current.txt");
            document.getElementById("btn-browse-read-ids")?.click();
            await settleEventHandlers();

            expect(
                document.getElementById("file-summary")?.textContent,
            ).toContain("current");
        } finally {
            consoleError.mockRestore();
        }
    });

    it("uses generation to reject an older peek for the same BAM path", async () => {
        const olderPeek = createDeferredPromise<PeekResult>();
        const newerPeek = createDeferredPromise<PeekResult>();
        samePathPeekResponses.push(olderPeek.promise, newerPeek.promise);

        selectBam("same-path.bam");
        selectBam("same-path.bam");
        newerPeek.resolve(currentPeek);
        await settleEventHandlers();

        olderPeek.resolve(createPeekResult("stale"));
        await settleEventHandlers();

        pickedReadIdPaths.push("current.txt");
        document.getElementById("btn-browse-read-ids")?.click();
        await settleEventHandlers();

        expect(document.getElementById("file-summary")?.textContent).toContain(
            "current",
        );
    });

    it("does not expose a stale successful read ID count after a later refresh", async () => {
        pickedReadIdPaths.push("stale-success.txt", "current.txt");
        document.getElementById("btn-browse-read-ids")?.click();
        await settleEventHandlers();
        document.getElementById("btn-browse-read-ids")?.click();
        await settleEventHandlers();

        staleSuccessfulReadIdCount.resolve(11);
        await settleEventHandlers();

        selectBam("current.bam");
        await settleEventHandlers();

        expect(document.getElementById("file-summary")?.textContent).toContain(
            "22 read IDs",
        );
        expect(
            document.getElementById("file-summary")?.textContent,
        ).not.toContain("11 read IDs");
    });

    it("does not clear a current read ID count when a stale request fails", async () => {
        const consoleError = suppressConsoleError();
        try {
            pickedReadIdPaths.push("stale.txt", "current.txt");
            document.getElementById("btn-browse-read-ids")?.click();
            await settleEventHandlers();
            document.getElementById("btn-browse-read-ids")?.click();
            await settleEventHandlers();

            staleReadIdCount.reject(new Error("stale count failed"));
            await settleEventHandlers();

            selectBam("current.bam");
            await settleEventHandlers();

            expect(
                document.getElementById("file-summary")?.textContent,
            ).toContain("22 read IDs");
        } finally {
            consoleError.mockRestore();
        }
    });

    it("uses generation to reject an older count for the same read ID path", async () => {
        const olderCount = createDeferredPromise<number>();
        const newerCount = createDeferredPromise<number>();
        samePathReadIdCountResponses.push(
            olderCount.promise,
            newerCount.promise,
        );
        pickedReadIdPaths.push("same-path.txt", "same-path.txt");

        document.getElementById("btn-browse-read-ids")?.click();
        await settleEventHandlers();
        document.getElementById("btn-browse-read-ids")?.click();
        newerCount.resolve(22);
        await settleEventHandlers();

        olderCount.resolve(11);
        await settleEventHandlers();

        selectBam("current.bam");
        await settleEventHandlers();

        expect(document.getElementById("file-summary")?.textContent).toContain(
            "22 read IDs",
        );
    });
});
