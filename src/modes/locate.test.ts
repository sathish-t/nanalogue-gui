import { beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable jsdoc/require-jsdoc */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: (
            name: string,
            handler: (...args: unknown[]) => Promise<unknown>,
        ) => handlers.set(name, handler),
    },
    dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("node:fs", () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock("@nanalogue/node", () => ({ readInfo: vi.fn() }));
vi.mock("../lib/ipc-path-validation", () => ({
    validateIpcFilePath: vi.fn(),
    validateIpcRemoteBamUrl: vi.fn(),
}));
vi.mock("../lib/line-counter", () => ({ countNonEmptyLines: vi.fn() }));

const { dialog } = await import("electron");
const { readFileSync, writeFileSync } = await import("node:fs");
const { readInfo } = await import("@nanalogue/node");
const { validateIpcFilePath } = await import("../lib/ipc-path-validation");
const { countNonEmptyLines } = await import("../lib/line-counter");
const { registerLocateIpcHandlers, setLocateMainWindow } = await import(
    "./locate"
);

registerLocateIpcHandlers();
const generate = handlers.get("locate-generate-bed");
const pick = handlers.get("locate-pick-read-ids");
const count = handlers.get("locate-count-read-ids");
if (!generate || !pick || !count)
    throw new Error("Locate handlers were not registered");

describe("Locate IPC handlers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setLocateMainWindow({} as Electron.BrowserWindow);
    });

    it("registers all Locate-owned handlers", () => {
        expect([...handlers.keys()]).toEqual([
            "locate-pick-read-ids",
            "locate-count-read-ids",
            "locate-generate-bed",
        ]);
    });

    it("validates payload shape before paths", async () => {
        await expect(generate({}, { bamPath: 42 })).rejects.toThrow(
            "Invalid Locate request",
        );
        expect(validateIpcFilePath).not.toHaveBeenCalled();
    });

    it("rejects full-region filtering without a region", async () => {
        await expect(
            generate(
                {},
                {
                    bamPath: "/a.bam",
                    readIdPath: "/ids",
                    outputPath: "/out",
                    treatAsUrl: false,
                    fullRegion: true,
                },
            ),
        ).rejects.toThrow("fullRegion requires region");
        expect(validateIpcFilePath).not.toHaveBeenCalled();
    });

    it("validates local input and output paths", async () => {
        vi.mocked(readFileSync).mockReturnValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        await generate(
            {},
            {
                bamPath: "/a.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                treatAsUrl: false,
            },
        );
        expect(validateIpcFilePath).toHaveBeenNthCalledWith(
            1,
            "/a.bam",
            "read",
        );
        expect(validateIpcFilePath).toHaveBeenNthCalledWith(2, "/ids", "read");
        expect(validateIpcFilePath).toHaveBeenNthCalledWith(3, "/out", "write");
    });

    it("rejects capped read IDs", async () => {
        vi.mocked(readFileSync).mockReturnValue(
            Array.from({ length: 200_001 }, (_, index) => `id-${index}`).join(
                "\n",
            ),
        );
        await expect(
            generate(
                {},
                {
                    bamPath: "https://x",
                    readIdPath: "/ids",
                    outputPath: "/out",
                    treatAsUrl: true,
                },
            ),
        ).rejects.toThrow("200,000");
        expect(readInfo).not.toHaveBeenCalled();
    });

    it("generates and writes BED output", async () => {
        vi.mocked(readFileSync).mockReturnValue("read-1\nmissing\n");
        vi.mocked(readInfo).mockResolvedValue([
            {
                read_id: "read-1",
                alignment_type: "primary_forward",
                contig: "chr1",
                reference_start: 10,
                reference_end: 20,
            },
        ] as Awaited<ReturnType<typeof readInfo>>);
        const result = await generate(
            {},
            {
                bamPath: "https://x",
                readIdPath: "/ids",
                outputPath: "/out",
                treatAsUrl: true,
            },
        );
        expect(writeFileSync).toHaveBeenCalledWith(
            "/out",
            "chr1\t10\t20\tread-1\t1000\t+\n",
            "utf-8",
        );
        expect(result).toMatchObject({
            totalIds: 2,
            found: 1,
            bedEntries: 1,
            notFound: 1,
        });
    });

    it("returns null without a window or when the picker is cancelled", async () => {
        setLocateMainWindow(null);
        await expect(pick()).resolves.toBeNull();
        setLocateMainWindow({} as Electron.BrowserWindow);
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: true,
            filePaths: [],
        });
        await expect(pick()).resolves.toBeNull();
    });

    it("returns the selected read ID path", async () => {
        vi.mocked(dialog.showOpenDialog).mockResolvedValue({
            canceled: false,
            filePaths: ["/data/read-ids.txt"],
        });
        await expect(pick()).resolves.toBe("/data/read-ids.txt");
    });

    it("validates and counts a read ID file", async () => {
        vi.mocked(countNonEmptyLines).mockReturnValue(3);
        await expect(count({}, "/data/read-ids.txt")).resolves.toBe(3);
        expect(validateIpcFilePath).toHaveBeenCalledWith(
            "/data/read-ids.txt",
            "read",
        );
    });

    it("rejects an invalid read ID path", async () => {
        await expect(count({}, "")).rejects.toThrow(
            "Invalid Locate read ID path",
        );
        expect(validateIpcFilePath).not.toHaveBeenCalled();
    });

    it("passes region filtering to BAM read-info loading", async () => {
        vi.mocked(readFileSync).mockReturnValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        await generate(
            {},
            {
                bamPath: "https://example.com/sample.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                treatAsUrl: true,
                region: "chr1:10-20",
                fullRegion: true,
            },
        );
        expect(readInfo).toHaveBeenCalledWith({
            bamPath: "https://example.com/sample.bam",
            treatAsUrl: true,
            readIdSet: ["read-1"],
            region: "chr1:10-20",
            fullRegion: true,
        });
    });
});
