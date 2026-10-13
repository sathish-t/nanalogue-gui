import { beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable jsdoc/require-jsdoc */

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("../electron-security", () => ({
    registerTrustedIpcHandler: (
        name: string,
        handler: (...args: unknown[]) => Promise<unknown>,
    ) => handlers.set(name, handler),
}));
vi.mock("node:fs/promises", () => ({
    readFile: vi.fn(),
    realpath: vi.fn(async (filePath: string) => filePath),
    stat: vi.fn(async (filePath: string) => ({
        dev: 1,
        ino: [...filePath].reduce(
            (hash, character) => hash * 31 + character.charCodeAt(0),
            7,
        ),
    })),
    writeFile: vi.fn(),
}));
vi.mock("@nanalogue/node", () => ({ readInfo: vi.fn() }));
vi.mock("../lib/ipc-path-validation", () => ({
    validateIpcFilePath: vi.fn(),
}));

const { readFile, writeFile } = await import("node:fs/promises");
const { readInfo } = await import("@nanalogue/node");
const { validateIpcFilePath } = await import("../lib/ipc-path-validation");
const { registerLocateIpcHandlers } = await import("./locate");

registerLocateIpcHandlers();
const generate = handlers.get("locate-generate-bed");
if (!generate) throw new Error("Locate handler was not registered");

describe("Locate IPC handlers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers all Locate-owned handlers", () => {
        expect([...handlers.keys()]).toEqual(["locate-generate-bed"]);
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
                    overwriteConfirmed: false,
                    fullRegion: true,
                },
            ),
        ).rejects.toThrow("fullRegion requires region");
        expect(validateIpcFilePath).not.toHaveBeenCalled();
    });

    it("validates local input and output paths", async () => {
        vi.mocked(readFile).mockResolvedValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        await generate(
            {},
            {
                bamPath: "/a.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                overwriteConfirmed: false,
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
        vi.mocked(readFile).mockResolvedValue(
            Array.from({ length: 200_001 }, (_, index) => `id-${index}`).join(
                "\n",
            ),
        );
        await expect(
            generate(
                {},
                {
                    bamPath: "/a.bam",
                    readIdPath: "/ids",
                    outputPath: "/out",
                    overwriteConfirmed: false,
                },
            ),
        ).rejects.toThrow("200,000");
        expect(readInfo).not.toHaveBeenCalled();
    });

    it("generates and writes BED output", async () => {
        vi.mocked(readFile).mockResolvedValue("read-1\nmissing\n");
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
                bamPath: "/a.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                overwriteConfirmed: false,
            },
        );
        expect(writeFile).toHaveBeenCalledWith(
            "/out",
            "chr1\t10\t20\tread-1\t1000\t+\n",
            { encoding: "utf-8", flag: "wx" },
        );
        expect(result).toMatchObject({
            totalIds: 2,
            found: 1,
            bedEntries: 1,
            notFound: 1,
        });
    });

    it("allows replacement only with explicit overwrite authorization", async () => {
        vi.mocked(readFile).mockResolvedValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);

        await generate(
            {},
            {
                bamPath: "/a.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                overwriteConfirmed: true,
            },
        );

        expect(writeFile).toHaveBeenCalledWith("/out", "", {
            encoding: "utf-8",
            flag: "w",
        });
    });

    it.each([
        false,
        true,
    ])("rejects overlapping overwrites and permits retry after write failure=%s", async (failWrite) => {
        vi.mocked(readFile).mockResolvedValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        let releaseWrite!: () => void;
        vi.mocked(writeFile).mockImplementationOnce(
            () =>
                new Promise<void>((resolve, reject) => {
                    releaseWrite = () =>
                        failWrite ? reject(new Error("disk full")) : resolve();
                }),
        );
        const request = {
            bamPath: "/a.bam",
            readIdPath: "/ids",
            outputPath: "/out",
            overwriteConfirmed: true,
        };
        const pending = generate({}, request);
        const finished = failWrite
            ? expect(pending).rejects.toThrow("disk full")
            : expect(pending).resolves.toMatchObject({ bedEntries: 0 });
        try {
            await vi.waitFor(() => expect(releaseWrite).toBeDefined());
            await expect(generate({}, request)).rejects.toThrow(
                "Locate generation is busy",
            );
            expect(writeFile).toHaveBeenCalledOnce();
        } finally {
            releaseWrite();
            await finished;
        }
        await expect(generate({}, request)).resolves.toMatchObject({
            bedEntries: 0,
        });
    });

    it("propagates an exclusive-create conflict without retrying a write", async () => {
        vi.mocked(readFile).mockResolvedValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        vi.mocked(writeFile).mockRejectedValueOnce(
            Object.assign(new Error("output appeared"), {
                code: "EEXIST",
            }),
        );

        await expect(
            generate(
                {},
                {
                    bamPath: "/a.bam",
                    readIdPath: "/ids",
                    outputPath: "/out",
                    overwriteConfirmed: false,
                },
            ),
        ).rejects.toThrow("output appeared");
        expect(writeFile).toHaveBeenCalledOnce();
    });

    it("passes region filtering to BAM read-info loading", async () => {
        vi.mocked(readFile).mockResolvedValue("read-1\n");
        vi.mocked(readInfo).mockResolvedValue([]);
        await generate(
            {},
            {
                bamPath: "/data/sample.bam",
                readIdPath: "/ids",
                outputPath: "/out",
                overwriteConfirmed: false,
                region: "chr1:10-20",
                fullRegion: true,
            },
        );
        expect(readInfo).toHaveBeenCalledWith({
            bamPath: "/data/sample.bam",
            readIdSet: ["read-1"],
            region: "chr1:10-20",
            fullRegion: true,
        });
    });
});
