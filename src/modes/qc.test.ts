// Tests for the QC mode IPC handlers.
// Verifies that peek-bam, select-file, generate-qc, and get-qc-data channels
// are registered and behave correctly, including the readIdFilePath resolution path.
//
// Uses top-level vi.mock (hoisted) so that all dependency modules are replaced
// before the module under test is imported. Module-level qcData state is
// exercised by invoking the generate-qc handler and inspecting get-qc-data.

import type { BrowserWindow } from "electron";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { QCConfig, QCData } from "../lib/types";

// ---------------------------------------------------------------------------
// Stable handler map – populated when registerIpcHandlers() runs.
// ---------------------------------------------------------------------------

/** IPC handlers registered by registerIpcHandlers(), keyed by channel name. */
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted by vitest before any import).
// ---------------------------------------------------------------------------

// Mock electron so ipcMain.handle captures handlers into ipcHandlers.
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
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: class {},
}));

// Mock qc-data-loader – actual BAM I/O is covered by its own test suite.
vi.mock("../lib/qc-data-loader", () => ({
    generateQCData: vi.fn(),
    peekBam: vi.fn(),
}));

// Mock font-size – not relevant to IPC handler logic.
vi.mock("../font-size", () => ({
    getFontSize: vi.fn().mockReturnValue("medium"),
}));

// Mock node:fs/promises – used inside generate-qc when readIdFilePath is set.
vi.mock("node:fs/promises", () => ({
    readFile: vi.fn(),
}));

// Mock locate-data-loader – parseReadIds is used inside generate-qc.
vi.mock("../lib/locate-data-loader", () => ({
    parseReadIds: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Top-level imports (after mocks are in place).
// ---------------------------------------------------------------------------

const { generateQCData, peekBam } = await import("../lib/qc-data-loader");
const { dialog } = await import("electron");
const { readFile } = await import("node:fs/promises");
const { parseReadIds } = await import("../lib/locate-data-loader");
const { registerIpcHandlers, setMainWindow } = await import("./qc");

// Register all IPC handlers once; ipcHandlers is populated as a side-effect.
registerIpcHandlers();

// ---------------------------------------------------------------------------
// Shared mock window object.
// ---------------------------------------------------------------------------

/** Mock webContents with a spy for the send method. */
const mockWebContents = { send: vi.fn() };

/** Mock BrowserWindow exposing webContents and loadFile spies. */
const mockWindow = {
    webContents: mockWebContents,
    loadFile: vi.fn(),
} as unknown as BrowserWindow;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("qc IPC handlers", () => {
    beforeAll(() => {
        // Sanity-check that all expected channels were registered.
        for (const channel of [
            "peek-bam",
            "select-file",
            "generate-qc",
            "get-qc-data",
        ]) {
            if (!ipcHandlers.has(channel)) {
                throw new Error(`${channel} handler not registered`);
            }
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        setMainWindow(null);
    });

    afterEach(() => {
        setMainWindow(null);
    });

    // -------------------------------------------------------------------------
    // peek-bam
    // -------------------------------------------------------------------------

    describe("peek-bam", () => {
        it("delegates to peekBam with the supplied arguments", async () => {
            vi.mocked(peekBam).mockResolvedValue({
                contigs: ["chr1"],
                totalContigs: 1,
                modifications: [],
                allContigs: { chr1: 1000 },
            });

            await ipcHandlers.get("peek-bam")?.(
                undefined,
                "/data/sample.bam",
                false,
            );

            expect(vi.mocked(peekBam)).toHaveBeenCalledOnce();
            expect(vi.mocked(peekBam)).toHaveBeenCalledWith(
                "/data/sample.bam",
                false,
            );
        });

        it("returns the result from peekBam", async () => {
            const mockResult = {
                contigs: ["chr1", "chr2"],
                totalContigs: 2,
                modifications: ["m6A"],
                allContigs: { chr1: 1000, chr2: 2000 },
            };
            vi.mocked(peekBam).mockResolvedValue(mockResult);

            const result = await ipcHandlers.get("peek-bam")?.(
                undefined,
                "/data/sample.bam",
                true,
            );

            expect(result).toEqual(mockResult);
        });
    });

    // -------------------------------------------------------------------------
    // select-file
    // -------------------------------------------------------------------------

    describe("select-file", () => {
        it("returns null immediately when mainWindow is not set", async () => {
            const result = await ipcHandlers.get("select-file")?.(undefined);
            expect(result).toBeNull();
            expect(vi.mocked(dialog.showOpenDialog)).not.toHaveBeenCalled();
        });

        it("opens a dialog and returns the selected path", async () => {
            setMainWindow(mockWindow);
            vi.mocked(dialog.showOpenDialog).mockResolvedValue({
                canceled: false,
                filePaths: ["/data/sample.bam"],
            });

            const result = await ipcHandlers.get("select-file")?.(undefined);

            expect(vi.mocked(dialog.showOpenDialog)).toHaveBeenCalledOnce();
            expect(result).toBe("/data/sample.bam");
        });

        it("returns null when the dialog is cancelled", async () => {
            setMainWindow(mockWindow);
            vi.mocked(dialog.showOpenDialog).mockResolvedValue({
                canceled: true,
                filePaths: [],
            });

            const result = await ipcHandlers.get("select-file")?.(undefined);

            expect(result).toBeNull();
        });

        it("returns null when dialog returns an empty filePaths array", async () => {
            setMainWindow(mockWindow);
            vi.mocked(dialog.showOpenDialog).mockResolvedValue({
                canceled: false,
                filePaths: [],
            });

            const result = await ipcHandlers.get("select-file")?.(undefined);

            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // get-qc-data — initial state
    // -------------------------------------------------------------------------

    describe("get-qc-data (initial state)", () => {
        it("returns null before generate-qc has been called", async () => {
            // This test must run before any generate-qc invocation to catch
            // the initial null state of the module-level qcData variable.
            const result = await ipcHandlers.get("get-qc-data")?.(undefined);
            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // generate-qc
    // -------------------------------------------------------------------------

    describe("generate-qc", () => {
        /** Minimal valid QCConfig without a readIdFilePath. */
        const baseConfig = {
            bamPath: "/data/sample.bam",
            treatAsUrl: false,
            sampleFraction: 5,
            sampleSeed: 42,
            windowSize: 300,
            readLengthBinWidth: 100,
            fullRegion: undefined,
        };

        /** Zero-valued Stats stub used inside stubQCData. */
        const zeroStats = {
            count: 0,
            sum: 0,
            min: 0,
            max: 0,
            mean: 0,
            p10: 0,
            p50: 0,
            p90: 0,
            stddev: 0,
        };

        /** Minimal stub QCData returned by the mock. */
        const stubQCData: QCData = {
            readLengthStats: { ...zeroStats },
            readLengthHistogram: [],
            yieldByLength: [],
            readLengthBinWidth: 100,
            exceededReadLengths: 0,
            wholeReadDensityStats: { ...zeroStats },
            wholeReadDensityHistogram: [],
            windowedDensityStats: { ...zeroStats },
            windowedDensityHistogram: [],
            rawProbabilityStats: { ...zeroStats },
            rawProbabilityHistogram: [],
            sampleSeed: 42,
            readTypeCounts: {
                primaryForward: 0,
                primaryReverse: 0,
                secondaryForward: 0,
                secondaryReverse: 0,
                supplementaryForward: 0,
                supplementaryReverse: 0,
                unmapped: 0,
            },
        };

        beforeEach(() => {
            setMainWindow(mockWindow);
            vi.mocked(
                mockWindow.loadFile as ReturnType<typeof vi.fn>,
            ).mockResolvedValue(undefined);
            vi.mocked(generateQCData).mockResolvedValue(stubQCData);
        });

        it("calls generateQCData with the provided config", async () => {
            await ipcHandlers.get("generate-qc")?.(undefined, {
                ...baseConfig,
            });

            expect(vi.mocked(generateQCData)).toHaveBeenCalledOnce();
            const [calledConfig] = vi.mocked(generateQCData).mock.calls[0];
            expect(calledConfig).toMatchObject({
                bamPath: "/data/sample.bam",
                sampleFraction: 5,
            });
        });

        it("calls mainWindow.loadFile after generateQCData completes", async () => {
            await ipcHandlers.get("generate-qc")?.(undefined, {
                ...baseConfig,
            });

            expect(
                vi.mocked(mockWindow.loadFile as ReturnType<typeof vi.fn>),
            ).toHaveBeenCalledOnce();
        });

        it("sends qc-progress events via webContents during generation", async () => {
            // Intercept the onProgress callback and invoke it synchronously.
            vi.mocked(generateQCData).mockImplementation(
                async (_config, onProgress) => {
                    onProgress?.("modifications", 100);
                    onProgress?.("windows", 50);
                    return stubQCData;
                },
            );

            await ipcHandlers.get("generate-qc")?.(undefined, {
                ...baseConfig,
            });

            expect(mockWebContents.send).toHaveBeenCalledWith(
                "qc-progress",
                "modifications",
                100,
            );
            expect(mockWebContents.send).toHaveBeenCalledWith(
                "qc-progress",
                "windows",
                50,
            );
        });

        it("resolves readIdFilePath and injects readIdSet into config", async () => {
            vi.mocked(readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
                "read-a\nread-b\n",
            );
            vi.mocked(parseReadIds as ReturnType<typeof vi.fn>).mockReturnValue(
                {
                    capped: false,
                    ids: ["read-a", "read-b"],
                    count: 2,
                },
            );

            await ipcHandlers.get("generate-qc")?.(undefined, {
                ...baseConfig,
                readIdFilePath: "/data/read-ids.txt",
            });

            expect(
                vi.mocked(readFile as ReturnType<typeof vi.fn>),
            ).toHaveBeenCalledWith("/data/read-ids.txt", "utf-8");
            expect(
                vi.mocked(parseReadIds as ReturnType<typeof vi.fn>),
            ).toHaveBeenCalledWith("read-a\nread-b\n");
            const [calledConfig] = vi.mocked(generateQCData).mock.calls[0];
            expect((calledConfig as QCConfig).readIdSet).toEqual([
                "read-a",
                "read-b",
            ]);
        });

        it("throws when the read ID file exceeds the 200 000-ID limit", async () => {
            vi.mocked(readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
                "",
            );
            vi.mocked(parseReadIds as ReturnType<typeof vi.fn>).mockReturnValue(
                {
                    capped: true,
                    ids: [],
                    count: 200_001,
                },
            );

            await expect(
                ipcHandlers.get("generate-qc")?.(undefined, {
                    ...baseConfig,
                    readIdFilePath: "/data/read-ids.txt",
                }),
            ).rejects.toThrow("200,001");
        });
    });

    // -------------------------------------------------------------------------
    // get-qc-data — after generate-qc
    // -------------------------------------------------------------------------

    describe("get-qc-data (after generate-qc)", () => {
        it("returns the data produced by the most recent generate-qc call", async () => {
            setMainWindow(mockWindow);
            const stubData = { sampleSeed: 99 } as unknown as QCData;
            vi.mocked(generateQCData).mockResolvedValue(stubData);

            await ipcHandlers.get("generate-qc")?.(undefined, {
                bamPath: "/data/sample.bam",
                treatAsUrl: false,
                sampleFraction: 5,
                sampleSeed: 99,
                windowSize: 300,
                readLengthBinWidth: 100,
                fullRegion: undefined,
            });

            const result = await ipcHandlers.get("get-qc-data")?.(undefined);
            expect(result).toEqual(stubData);
        });
    });
});
