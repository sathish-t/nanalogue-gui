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
import type { SwipeArgs } from "./swipe";

// ---------------------------------------------------------------------------
// IPC handler capture map.
// ---------------------------------------------------------------------------

/** IPC handlers registered by registerIpcHandlers(), keyed by channel name. */
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted before any import).
// ---------------------------------------------------------------------------

// Mock electron so ipcMain.handle captures handlers and dialog can be spied.
vi.mock("electron", () => ({
    ipcMain: {
        /**
         * Captures the handler into ipcHandlers for test invocation.
         *
         * @param channel - The IPC channel name.
         * @param handler - The handler to register.
         */
        handle: (
            channel: string,
            handler: (...args: unknown[]) => Promise<unknown>,
        ) => {
            ipcHandlers.set(channel, handler);
        },
    },
    dialog: {
        showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    },
}));

// Mock node:fs — controls realpathSync, existsSync, and file I/O helpers.
vi.mock("node:fs", () => ({
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    realpathSync: vi.fn((p: string) => p),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
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

const { appendFileSync, existsSync, realpathSync, writeFileSync } =
    await import("node:fs");
const { loadContigSizes, loadPlotData } = await import(
    "../lib/swipe-data-loader"
);
const { parseBedFile } = await import("../lib/bed-parser");
const { initialize, registerIpcHandlers, printSummary } = await import(
    "./swipe"
);

// Register IPC handlers once; ipcHandlers is populated as a side-effect.
registerIpcHandlers();

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
    windowSize: 200,
};

/**
 * Initializes swipe mode with fake data, skipping the overwrite dialog.
 *
 * @returns A promise that resolves when initialization completes.
 */
async function initializeWithFakes(): Promise<void> {
    vi.mocked(parseBedFile).mockReturnValue({
        capped: false,
        annotations: [...FAKE_ANNOTATIONS],
    });
    vi.mocked(loadContigSizes).mockResolvedValue({ chr1: 5000 });
    vi.mocked(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await initialize(BASE_ARGS, true);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("swipe mode — initialize()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(realpathSync as ReturnType<typeof vi.fn>).mockImplementation(
            (p: string) => p,
        );
        vi.mocked(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(
            false,
        );
        vi.mocked(loadContigSizes).mockResolvedValue({ chr1: 5000 });
    });

    it("calls loadContigSizes with the BAM path and treatAsUrl flag", async () => {
        vi.mocked(parseBedFile).mockReturnValue({
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initialize(BASE_ARGS, true);

        expect(vi.mocked(loadContigSizes)).toHaveBeenCalledWith(
            "/data/sample.bam",
            undefined,
        );
    });

    it("calls parseBedFile with the BED path", async () => {
        vi.mocked(parseBedFile).mockReturnValue({
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initialize(BASE_ARGS, true);

        expect(vi.mocked(parseBedFile)).toHaveBeenCalledWith(
            "/data/annotations.bed",
        );
    });

    it("writes an empty output file after successful initialization", async () => {
        vi.mocked(parseBedFile).mockReturnValue({
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });

        await initialize(BASE_ARGS, true);

        expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
            "/data/output.bed",
            "",
            "utf-8",
        );
    });

    it("throws when the BED file exceeds 10 000 annotations", async () => {
        vi.mocked(parseBedFile).mockReturnValue({
            capped: true,
            annotations: [],
        });

        await expect(initialize(BASE_ARGS, true)).rejects.toThrow("10,000");
    });

    it("throws when outputPath resolves to the same file as bedPath", async () => {
        vi.mocked(parseBedFile).mockReturnValue({
            capped: false,
            annotations: [...FAKE_ANNOTATIONS],
        });
        // Make realpathSync return the same value for both paths to trigger the guard.
        vi.mocked(realpathSync as ReturnType<typeof vi.fn>).mockReturnValue(
            "/data/same.bed",
        );
        vi.mocked(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const collidingArgs: SwipeArgs = {
            ...BASE_ARGS,
            outputPath: "/data/same.bed",
            bedPath: "/data/same.bed",
        };

        await expect(initialize(collidingArgs, true)).rejects.toThrow(
            "same file",
        );
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
        vi.mocked(realpathSync as ReturnType<typeof vi.fn>).mockImplementation(
            (p: string) => p,
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
            vi.mocked(loadPlotData).mockResolvedValue(
                fakePlotData as unknown as PlotData,
            );

            const result = await ipcHandlers.get("get-plot-data")?.(undefined);

            expect(vi.mocked(loadPlotData)).toHaveBeenCalledOnce();
            expect(result).toEqual(fakePlotData);
        });

        it("returns null when an error occurs during plot data loading", async () => {
            vi.mocked(loadPlotData).mockRejectedValue(new Error("BAM error"));
            vi.spyOn(console, "error").mockImplementation(() => undefined);

            const result = await ipcHandlers.get("get-plot-data")?.(undefined);

            expect(result).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // accept
    // -----------------------------------------------------------------------

    describe("accept", () => {
        it("increments acceptedCount and currentIndex", async () => {
            vi.mocked(loadPlotData).mockResolvedValue({
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
            vi.mocked(loadPlotData).mockResolvedValue({
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            await ipcHandlers.get("accept")?.(undefined);

            expect(vi.mocked(appendFileSync)).toHaveBeenCalledWith(
                "/data/output.bed",
                `${FAKE_ANNOTATIONS[0].rawLine}\n`,
                "utf-8",
            );
        });

        it("returns done: true when the last annotation is accepted", async () => {
            vi.mocked(loadPlotData).mockResolvedValue({
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
        it("increments rejectedCount and currentIndex", async () => {
            vi.mocked(loadPlotData).mockResolvedValue({
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
            vi.mocked(loadPlotData).mockResolvedValue({
                rawPoints: [],
                windowedPoints: [],
            } as unknown as PlotData);

            await ipcHandlers.get("reject")?.(undefined);

            expect(vi.mocked(appendFileSync)).not.toHaveBeenCalled();
        });

        it("returns done: true when the last annotation is rejected", async () => {
            vi.mocked(loadPlotData).mockResolvedValue({
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
});

// ---------------------------------------------------------------------------
// printSummary
// ---------------------------------------------------------------------------

describe("swipe mode — printSummary()", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(realpathSync as ReturnType<typeof vi.fn>).mockImplementation(
            (p: string) => p,
        );
        await initializeWithFakes();
    });

    it("logs reviewed, accepted, and rejected counts to the console", () => {
        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);

        printSummary();

        const output = consoleSpy.mock.calls
            .map((c) => String(c[0]))
            .join("\n");
        expect(output).toContain("0 / 2");
        expect(output).toContain("Accepted: 0");
        expect(output).toContain("Rejected: 0");
    });

    it("includes the output path in the summary", () => {
        const consoleSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => undefined);

        printSummary();

        const output = consoleSpy.mock.calls
            .map((c) => String(c[0]))
            .join("\n");
        expect(output).toContain("/data/output.bed");
    });
});
