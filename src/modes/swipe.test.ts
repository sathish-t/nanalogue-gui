// Tests for the swipe mode IPC handlers and initialization logic.
// Verifies that initialize() loads data and guards against path collisions,
// that get-state, get-plot-data, accept, and reject handlers behave correctly,
// and that printSummary logs the expected output.
//
// Uses top-level vi.mock (hoisted) for electron, node:fs, and lib modules.
// Module-level state (appState, annotations) is reset between tests by
// calling initialize() in beforeEach.

import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { PlotData } from "../lib/types";
import {
    setMockImplementation,
    setMockRejectedValue,
    setMockResolvedValue,
    suppressConsoleError,
} from "../test-helpers";
import type { SwipeArgs } from "./swipe";

// ---------------------------------------------------------------------------
// IPC handler capture map.
// ---------------------------------------------------------------------------

/** IPC handlers registered by registerIpcHandlers(), keyed by channel name. */
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted before any import).
// ---------------------------------------------------------------------------

// Mock Electron dialogs; sender validation has its own security test suite.
vi.mock("electron", () => ({
    dialog: {
        showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    },
}));

vi.mock("../electron-security", () => ({
    /**
     * Captures a trusted IPC handler for mode-level tests.
     *
     * @param channel - The IPC channel name.
     * @param handler - The mode handler to register.
     */
    registerTrustedIpcHandler: (
        channel: string,
        handler: (...args: unknown[]) => Promise<unknown>,
    ) => {
        ipcHandlers.set(channel, handler);
    },
}));

// Mock async filesystem operations used by Swipe mode.
vi.mock("node:fs/promises", () => ({
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
    appendFile: vi.fn(),
    realpath: vi.fn(async (path: string) => path),
    unlink: vi.fn(),
    writeFile: vi.fn(),
}));

// Mock swipe-data-loader — BAM I/O is covered by swipe-data-loader.test.ts.
vi.mock("../lib/swipe-data-loader", () => ({
    loadContigSizes: vi.fn().mockResolvedValue({ chr1: 5000 }),
    loadPlotData: vi.fn(),
}));

// Mock bed-parser — BED I/O is covered by bed-parser.test.ts.
vi.mock("../lib/bed-parser", () => ({
    parseBedFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Top-level imports (after mocks are hoisted).
// ---------------------------------------------------------------------------

const { access, appendFile, realpath, unlink, writeFile } = await import(
    "node:fs/promises"
);
const { dialog } = await import("electron");
const { loadContigSizes, loadPlotData } = await import(
    "../lib/swipe-data-loader"
);
const { parseBedFile } = await import("../lib/bed-parser");
const { initializeSwipeReview, registerSwipeIpcHandlers } = await import(
    "./swipe"
);

// Register IPC handlers once; ipcHandlers is populated as a side-effect.
registerSwipeIpcHandlers();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two synthetic BED annotations used across tests. */
const FAKE_ANNOTATIONS = [
    {
        contig: "chr1",
        start: 100,
        end: 200,
        readId: "read-a",
        rawLine: "chr1\t100\t200\tread-a",
    },
    {
        contig: "chr1",
        start: 300,
        end: 400,
        readId: "read-b",
        rawLine: "chr1\t300\t400\tread-b",
    },
];

/** Default SwipeArgs used in most tests. */
const BASE_ARGS: SwipeArgs = {
    bamPath: "/data/sample.bam",
    bedPath: "/data/annotations.bed",
    outputPath: "/data/output.bed",
    overwriteConfirmed: false,
    windowSize: 200,
};

/**
 * Initializes swipe mode with fake data, skipping the overwrite dialog.
 *
 * @returns A promise that resolves when initialization completes.
 */
async function initializeWithFakes(): Promise<void> {
    setMockResolvedValue(parseBedFile, {
        capped: false,
        annotations: [...FAKE_ANNOTATIONS],
    });
    setMockResolvedValue(loadContigSizes, { chr1: 5000 });
    setMockRejectedValue(access, new Error("ENOENT"));
    await initializeSwipeReview(BASE_ARGS, true);
}

// ---------------------------------------------------------------------------
// IPC handlers before initialize() is called (cliArgs is null).
// These tests rely on running before any test that calls initialize() —
// they must appear first so cliArgs is still null when they execute.
// ---------------------------------------------------------------------------

describe("swipe mode — IPC handlers before initialize (cliArgs is null)", () => {
    it("accept returns done and logs error when cliArgs is not set", async () => {
        const consoleSpy = suppressConsoleError();

        const result = (await ipcHandlers.get("accept")?.(
            undefined,
        )) as HandlerResult;

        expect(result.done).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
            "Unknown state: accept called without cliArgs set",
        );
        consoleSpy.mockRestore();
    });

    it("reject returns done and logs error when cliArgs is not set", async () => {
        const consoleSpy = suppressConsoleError();

        const result = (await ipcHandlers.get("reject")?.(
            undefined,
        )) as HandlerResult;

        expect(result.done).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
            "Unknown state: reject called without cliArgs set",
        );
        consoleSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("swipe mode — initialize()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockImplementation(
            realpath as ReturnType<typeof vi.fn>,
            async (path: string) => path,
        );
        setMockRejectedValue(access, new Error("ENOENT"));
        setMockResolvedValue(loadContigSizes, { chr1: 5000 });
    });

    it("calls loadContigSizes with the local BAM path", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initializeSwipeReview(BASE_ARGS, true);

        expect(vi.mocked(loadContigSizes)).toHaveBeenCalledWith(
            "/data/sample.bam",
        );
    });

    it("calls parseBedFile with the BED path", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initializeSwipeReview(BASE_ARGS, true);

        expect(vi.mocked(parseBedFile)).toHaveBeenCalledWith(
            "/data/annotations.bed",
        );
    });

    it("writes an empty output file after successful initialization", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initializeSwipeReview(BASE_ARGS, false);

        expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
            "/data/output.bed",
            "",
            { encoding: "utf-8", flag: "wx" },
        );
    });

    it("propagates an exclusive-create conflict without deleting output", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });
        vi.mocked(writeFile).mockRejectedValueOnce(
            Object.assign(new Error("output appeared"), {
                code: "EEXIST",
            }),
        );

        await expect(initializeSwipeReview(BASE_ARGS, false)).rejects.toThrow(
            "output appeared",
        );
        expect(unlink).not.toHaveBeenCalled();
    });

    it("rechecks for an output file before writing", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });
        vi.mocked(access)
            .mockRejectedValueOnce(new Error("ENOENT"))
            .mockResolvedValueOnce(undefined);
        setMockResolvedValue(dialog.showMessageBox, { response: 1 });

        await expect(initializeSwipeReview(BASE_ARGS, false)).rejects.toThrow(
            "User cancelled: output file exists",
        );
        expect(dialog.showMessageBox).toHaveBeenCalledOnce();
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("throws when the BED file exceeds 10 000 annotations", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: true,
            annotations: [],
        });

        await expect(initializeSwipeReview(BASE_ARGS, true)).rejects.toThrow(
            "10,000",
        );
    });

    it("throws when outputPath resolves to the same file as bedPath", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });
        // Make realpath return the same value for both paths to trigger the guard.
        setMockResolvedValue(realpath, "/data/same.bed");
        setMockResolvedValue(access, undefined);

        const collidingArgs: SwipeArgs = {
            ...BASE_ARGS,
            outputPath: "/data/same.bed",
            bedPath: "/data/same.bed",
        };

        await expect(
            initializeSwipeReview(collidingArgs, true),
        ).rejects.toThrow("same file");
    });

    it("throws when resolved outputPath matches bedPath and output file does not yet exist", async () => {
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });
        // access rejects so the first guard is skipped; the second guard
        // catches the collision via path.resolve vs realpath.
        setMockRejectedValue(access, new Error("ENOENT"));

        const collidingArgs: SwipeArgs = {
            ...BASE_ARGS,
            outputPath: "/data/annotations.bed",
            bedPath: "/data/annotations.bed",
        };

        await expect(
            initializeSwipeReview(collidingArgs, true),
        ).rejects.toThrow("same file");
    });
});

// ---------------------------------------------------------------------------
// Local types used in IPC handler assertions.
// ---------------------------------------------------------------------------

/**
 * Application state snapshot returned by get-state, accept, and reject handlers.
 */
interface TestAppState {
    /** Current annotation index. */
    currentIndex: number;
    /** Total number of annotations. */
    totalCount: number;
    /** Number of accepted annotations. */
    acceptedCount: number;
    /** Number of rejected annotations. */
    rejectedCount: number;
}

/**
 * Result returned by the accept and reject IPC handlers.
 */
interface HandlerResult {
    /** Whether all annotations have been reviewed. */
    done: boolean;
    /** The updated application state. */
    state: TestAppState;
    /** Optional plot data for the next annotation. */
    plotData?: unknown;
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

describe("swipe mode — IPC handlers", () => {
    beforeAll(() => {
        for (const channel of [
            "get-state",
            "get-plot-data",
            "accept",
            "reject",
        ]) {
            if (!ipcHandlers.has(channel)) {
                throw new Error(`${channel} handler not registered`);
            }
        }
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        setMockImplementation(
            realpath as ReturnType<typeof vi.fn>,
            async (path: string) => path,
        );
        await initializeWithFakes();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // get-state
    // -----------------------------------------------------------------------

    describe("get-state", () => {
        it("returns the initial appState after initialize", async () => {
            const state = (await ipcHandlers.get("get-state")?.(
                undefined,
            )) as TestAppState;

            expect(state.currentIndex).toBe(0);
            expect(state.totalCount).toBe(2);
            expect(state.acceptedCount).toBe(0);
            expect(state.rejectedCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // get-plot-data
    // -----------------------------------------------------------------------

    describe("get-plot-data", () => {
        it("calls loadPlotData and returns the result", async () => {
            const fakePlotData = { rawPoints: [], windowedPoints: [] };
            setMockResolvedValue(
                loadPlotData,
                fakePlotData as unknown as PlotData,
            );

            const result = await ipcHandlers.get("get-plot-data")?.(undefined);

            expect(vi.mocked(loadPlotData)).toHaveBeenCalledOnce();
            expect(result).toEqual(fakePlotData);
        });

        it("rejects when an error occurs during plot data loading", async () => {
            setMockRejectedValue(loadPlotData, new Error("BAM error"));

            await expect(
                ipcHandlers.get("get-plot-data")?.(undefined),
            ).rejects.toThrow("BAM error");
        });
    });

    // -----------------------------------------------------------------------
    // accept
    // -----------------------------------------------------------------------

    describe("accept", () => {
        it("writes the current annotation, advances, and returns the next plot", async () => {
            const nextPlotData = {
                rawPoints: [{ x: 310, y: 0.75 }],
                windowedPoints: [],
            } as unknown as PlotData;
            setMockResolvedValue(loadPlotData, nextPlotData);

            const response = (await ipcHandlers.get("accept")?.(
                undefined,
            )) as HandlerResult;

            expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
                "/data/output.bed",
                `${FAKE_ANNOTATIONS[0].rawLine}\n`,
                "utf-8",
            );
            expect(vi.mocked(loadPlotData)).toHaveBeenCalledWith(
                BASE_ARGS.bamPath,
                FAKE_ANNOTATIONS[1],
                { chr1: 5000 },
                BASE_ARGS.windowSize,
                {
                    modTag: undefined,
                    modStrand: undefined,
                    regionExpansion: undefined,
                    treatAsUrl: undefined,
                },
            );
            expect(response).toEqual({
                done: false,
                state: expect.objectContaining({
                    acceptedCount: 1,
                    rejectedCount: 0,
                    currentIndex: 1,
                }),
                plotData: nextPlotData,
            });
        });

        it("increments acceptedCount and currentIndex", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            const response = (await ipcHandlers.get("accept")?.(
                undefined,
            )) as HandlerResult;

            expect(response.state.acceptedCount).toBe(1);
            expect(response.state.currentIndex).toBe(1);
        });

        it("writes the accepted annotation to the output file", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            await ipcHandlers.get("accept")?.(undefined);

            expect(vi.mocked(appendFile)).toHaveBeenCalledWith(
                "/data/output.bed",
                `${FAKE_ANNOTATIONS[0].rawLine}\n`,
                "utf-8",
            );
        });

        it("returns done: true when the last annotation is accepted", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            // Accept both annotations.
            await ipcHandlers.get("accept")?.(undefined);
            const final = (await ipcHandlers.get("accept")?.(
                undefined,
            )) as HandlerResult;

            expect(final.done).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // reject
    // -----------------------------------------------------------------------

    describe("reject", () => {
        it("advances without writing and returns the next plot", async () => {
            const nextPlotData = {
                rawPoints: [{ x: 310, y: 0.75 }],
                windowedPoints: [],
            } as unknown as PlotData;
            setMockResolvedValue(loadPlotData, nextPlotData);

            const response = (await ipcHandlers.get("reject")?.(
                undefined,
            )) as HandlerResult;

            expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
            expect(vi.mocked(loadPlotData)).toHaveBeenCalledWith(
                BASE_ARGS.bamPath,
                FAKE_ANNOTATIONS[1],
                { chr1: 5000 },
                BASE_ARGS.windowSize,
                {
                    modTag: undefined,
                    modStrand: undefined,
                    regionExpansion: undefined,
                    treatAsUrl: undefined,
                },
            );
            expect(response).toEqual({
                done: false,
                state: expect.objectContaining({
                    acceptedCount: 0,
                    rejectedCount: 1,
                    currentIndex: 1,
                }),
                plotData: nextPlotData,
            });
        });

        it("increments rejectedCount and currentIndex", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            const response = (await ipcHandlers.get("reject")?.(
                undefined,
            )) as HandlerResult;

            expect(response.state.rejectedCount).toBe(1);
            expect(response.state.currentIndex).toBe(1);
        });

        it("does NOT write to the output file on reject", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            await ipcHandlers.get("reject")?.(undefined);

            expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
        });

        it("returns done: true when the last annotation is rejected", async () => {
            setMockResolvedValue(loadPlotData, {
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            await ipcHandlers.get("reject")?.(undefined);
            const final = (await ipcHandlers.get("reject")?.(
                undefined,
            )) as HandlerResult;

            expect(final.done).toBe(true);
        });
    });

    it("keeps accept and reject advance/load-next response shapes aligned", async () => {
        const nextPlotData = {
            rawPoints: [],
            windowedPoints: [],
        } as unknown as PlotData;
        setMockResolvedValue(loadPlotData, nextPlotData);

        const acceptResponse = (await ipcHandlers.get("accept")?.(
            undefined,
        )) as HandlerResult;
        const acceptShape = {
            keys: Object.keys(acceptResponse).sort(),
            done: acceptResponse.done,
            currentIndex: acceptResponse.state.currentIndex,
            plotData: acceptResponse.plotData,
        };

        await initializeWithFakes();
        const rejectResponse = (await ipcHandlers.get("reject")?.(
            undefined,
        )) as HandlerResult;
        const rejectShape = {
            keys: Object.keys(rejectResponse).sort(),
            done: rejectResponse.done,
            currentIndex: rejectResponse.state.currentIndex,
            plotData: rejectResponse.plotData,
        };

        expect(rejectShape).toEqual(acceptShape);
    });
});

// ---------------------------------------------------------------------------
// Overwrite dialog (skipOverwriteConfirm = false)
// ---------------------------------------------------------------------------

describe("swipe mode — initialize() overwrite dialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMockImplementation(
            realpath as ReturnType<typeof vi.fn>,
            async (path: string) => path,
        );
        setMockResolvedValue(loadContigSizes, { chr1: 5000 });
        setMockResolvedValue(parseBedFile, {
            capped: false,
            annotations: [
                {
                    contig: "chr1",
                    start: 100,
                    end: 200,
                    readId: "r1",
                    rawLine: "chr1\t100\t200\tr1",
                },
            ],
        });
        // Output file exists by default in these tests
        setMockResolvedValue(access, undefined);
        // Default dialog response: user confirms (response 0 = Overwrite)
        setMockResolvedValue(dialog.showMessageBox, { response: 0 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows the overwrite dialog when output file exists and skipOverwriteConfirm is false", async () => {
        await initializeSwipeReview(BASE_ARGS, false);

        expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    });

    it("deletes the existing output file when user confirms overwrite", async () => {
        await initializeSwipeReview(BASE_ARGS, false);

        expect(vi.mocked(unlink)).toHaveBeenCalledWith(BASE_ARGS.outputPath);
    });

    it("does not show the dialog when skipOverwriteConfirm is true", async () => {
        await initializeSwipeReview(BASE_ARGS, true);

        expect(dialog.showMessageBox).not.toHaveBeenCalled();
        expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
            BASE_ARGS.outputPath,
            "",
            { encoding: "utf-8", flag: "w" },
        );
    });

    it("throws when user cancels the overwrite dialog", async () => {
        // Response 1 = Cancel button
        setMockResolvedValue(dialog.showMessageBox, { response: 1 });

        await expect(initializeSwipeReview(BASE_ARGS, false)).rejects.toThrow(
            "User cancelled",
        );
    });

    it("does not delete the file when user cancels", async () => {
        setMockResolvedValue(dialog.showMessageBox, { response: 1 });

        await expect(initializeSwipeReview(BASE_ARGS, false)).rejects.toThrow();
        expect(vi.mocked(unlink)).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Additional IPC handler edge cases
// ---------------------------------------------------------------------------

describe("swipe mode — IPC handler edge cases", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        setMockImplementation(
            realpath as ReturnType<typeof vi.fn>,
            async (path: string) => path,
        );
        // Reset appendFile to a no-op since vi.clearAllMocks() does not
        // restore mock implementations set by individual tests.
        setMockResolvedValue(appendFile, undefined);
        await initializeWithFakes();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("get-plot-data returns null after all annotations have been reviewed", async () => {
        // Accept both annotations to exhaust the list
        setMockResolvedValue(loadPlotData, {
            rawPoints: [],
            windowedPoints: [],
        } as unknown as PlotData);
        await ipcHandlers.get("accept")?.(undefined);
        await ipcHandlers.get("accept")?.(undefined);

        // Subsequent get-plot-data should short-circuit and return null
        vi.mocked(loadPlotData).mockClear();
        const result = await ipcHandlers.get("get-plot-data")?.(undefined);

        expect(result).toBeNull();
        // loadPlotData should never be called when there are no more annotations
        expect(vi.mocked(loadPlotData)).not.toHaveBeenCalled();
    });

    it.each([
        "accept",
        "reject",
        "initialize",
    ])("blocks %s during an append without corrupting either session", async (operation) => {
        let releaseWrite!: () => void;
        vi.mocked(appendFile).mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseWrite = resolve;
                }),
        );
        setMockResolvedValue(loadPlotData, null);
        const accepting = ipcHandlers.get("accept")?.();
        const nextArgs = { ...BASE_ARGS, outputPath: "/data/next.bed" };
        try {
            await vi.waitFor(() => expect(releaseWrite).toBeDefined());
            const competing =
                operation === "initialize"
                    ? initializeSwipeReview(nextArgs, true)
                    : ipcHandlers.get(operation)?.();
            await expect(competing).rejects.toThrow("Swipe review is busy");
        } finally {
            releaseWrite();
            await accepting;
        }
        expect(await ipcHandlers.get("get-state")?.()).toMatchObject({
            currentIndex: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            outputPath: BASE_ARGS.outputPath,
        });
        expect(vi.mocked(appendFile).mock.calls).toEqual([
            [BASE_ARGS.outputPath, `${FAKE_ANNOTATIONS[0].rawLine}\n`, "utf-8"],
        ]);
        await initializeSwipeReview(nextArgs, true);
        expect(await ipcHandlers.get("reject")?.()).toMatchObject({
            state: {
                currentIndex: 1,
                acceptedCount: 0,
                rejectedCount: 1,
                outputPath: nextArgs.outputPath,
            },
        });
    });

    it.each([
        "initialize",
        "accept",
        "reject",
    ])("blocks review mutations until %s finishes loading", async (operation) => {
        let releaseLoad!: () => void;
        const loading = new Promise<void>((resolve) => {
            releaseLoad = resolve;
        });
        let started = false;
        if (operation === "initialize") {
            vi.mocked(loadContigSizes).mockImplementationOnce(async () => {
                started = true;
                await loading;
                return { chr1: 5000 };
            });
        } else {
            vi.mocked(loadPlotData).mockImplementationOnce(async () => {
                started = true;
                await loading;
                return null;
            });
        }
        const pending =
            operation === "initialize"
                ? initializeSwipeReview(BASE_ARGS, true)
                : ipcHandlers.get(operation)?.();
        try {
            await vi.waitFor(() => expect(started).toBe(true));
            await expect(
                initializeSwipeReview(BASE_ARGS, true),
            ).rejects.toThrow("Swipe review is busy");
            await expect(ipcHandlers.get("accept")?.()).rejects.toThrow(
                "Swipe review is busy",
            );
            await expect(ipcHandlers.get("reject")?.()).rejects.toThrow(
                "Swipe review is busy",
            );
        } finally {
            releaseLoad();
            await pending;
        }
        await expect(initializeWithFakes()).resolves.toBeUndefined();
    });

    it("accept retries the same annotation after an output write failure", async () => {
        setMockResolvedValue(loadPlotData, {
            rawPoints: [],
            windowedPoints: [],
        } as unknown as PlotData);
        vi.mocked(appendFile).mockRejectedValueOnce(new Error("disk full"));

        await expect(ipcHandlers.get("accept")?.(undefined)).rejects.toThrow(
            "disk full",
        );

        const state = (await ipcHandlers.get("get-state")?.(
            undefined,
        )) as TestAppState;
        expect(state.acceptedCount).toBe(0);
        expect(state.currentIndex).toBe(0);
        expect(vi.mocked(loadPlotData)).not.toHaveBeenCalled();

        const retryResult = (await ipcHandlers.get("accept")?.(
            undefined,
        )) as HandlerResult;

        expect(vi.mocked(appendFile)).toHaveBeenNthCalledWith(
            1,
            BASE_ARGS.outputPath,
            `${FAKE_ANNOTATIONS[0].rawLine}\n`,
            "utf-8",
        );
        expect(vi.mocked(appendFile)).toHaveBeenNthCalledWith(
            2,
            BASE_ARGS.outputPath,
            `${FAKE_ANNOTATIONS[0].rawLine}\n`,
            "utf-8",
        );
        expect(retryResult.state.acceptedCount).toBe(1);
        expect(retryResult.state.currentIndex).toBe(1);
        expect(vi.mocked(loadPlotData)).toHaveBeenCalledWith(
            BASE_ARGS.bamPath,
            FAKE_ANNOTATIONS[1],
            { chr1: 5000 },
            BASE_ARGS.windowSize,
            expect.any(Object),
        );
    });

    it("accept resolves with plotData null when next plot load fails", async () => {
        // First accept succeeds (write works), but loading the next plot fails.
        setMockRejectedValue(loadPlotData, new Error("BAM read error"));
        suppressConsoleError();

        const result = (await ipcHandlers.get("accept")?.(
            undefined,
        )) as HandlerResult;

        // The accept was recorded — counter and index advanced.
        expect(result.state.acceptedCount).toBe(1);
        expect(result.state.currentIndex).toBe(1);
        // But no plot data is available for the next annotation.
        expect(result.plotData).toBeNull();
    });

    it("reject resolves with plotData null when next plot load fails", async () => {
        setMockRejectedValue(loadPlotData, new Error("BAM read error"));
        suppressConsoleError();

        const result = (await ipcHandlers.get("reject")?.(
            undefined,
        )) as HandlerResult;

        expect(result.state.rejectedCount).toBe(1);
        expect(result.state.currentIndex).toBe(1);
        expect(result.plotData).toBeNull();
    });

    it("accept logs error when called after all annotations are exhausted", async () => {
        setMockResolvedValue(loadPlotData, {
            rawPoints: [],
            windowedPoints: [],
        } as unknown as PlotData);

        // Exhaust both annotations
        await ipcHandlers.get("accept")?.(undefined);
        await ipcHandlers.get("accept")?.(undefined);

        const consoleSpy = suppressConsoleError();
        const result = (await ipcHandlers.get("accept")?.(
            undefined,
        )) as HandlerResult;

        expect(result.done).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
            "Unknown state: accept called even though we've run out of annotations",
        );
    });

    it("reject logs error when called after all annotations are exhausted", async () => {
        setMockResolvedValue(loadPlotData, {
            rawPoints: [],
            windowedPoints: [],
        } as unknown as PlotData);

        // Exhaust both annotations
        await ipcHandlers.get("reject")?.(undefined);
        await ipcHandlers.get("reject")?.(undefined);

        const consoleSpy = suppressConsoleError();
        const result = (await ipcHandlers.get("reject")?.(
            undefined,
        )) as HandlerResult;

        expect(result.done).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
            "Unknown state: reject called even though we've run out of annotations",
        );
    });
});
