// Tests for the shared BAM inspection IPC handler.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMockResolvedValue } from "../test-helpers";

/** Registered IPC handlers keyed by channel name. */
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
    ipcMain: {
        /**
         * Captures an IPC handler for direct test invocation.
         *
         * @param channel - The IPC channel name.
         * @param handler - The handler registered for the channel.
         */
        handle: (
            channel: string,
            handler: (...args: unknown[]) => Promise<unknown>,
        ) => {
            ipcHandlers.set(channel, handler);
        },
    },
}));

vi.mock("../lib/ipc-path-validation", () => ({
    validateIpcFilePath: vi.fn(),
}));

vi.mock("../lib/qc-data-loader", () => ({
    peekBam: vi.fn(),
}));

const { validateIpcFilePath } = await import("../lib/ipc-path-validation");
const { peekBam } = await import("../lib/qc-data-loader");
const { registerBamInspectionIpcHandlers } = await import("./bam-inspection");

registerBamInspectionIpcHandlers();

describe("BAM inspection IPC handlers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers the peek-bam handler", () => {
        expect(ipcHandlers.has("peek-bam")).toBe(true);
    });

    it("validates and inspects a local BAM path", async () => {
        const mockResult = {
            contigs: ["chr1"],
            totalContigs: 1,
            modifications: [],
            allContigs: { chr1: 1000 },
        };
        setMockResolvedValue(peekBam, mockResult);

        const result = await ipcHandlers.get("peek-bam")?.(
            undefined,
            "/data/sample.bam",
        );

        expect(vi.mocked(validateIpcFilePath)).toHaveBeenCalledWith(
            "/data/sample.bam",
            "read",
        );
        expect(vi.mocked(peekBam)).toHaveBeenCalledWith("/data/sample.bam");
        expect(result).toEqual(mockResult);
    });

    it("does not peek when local path validation rejects", async () => {
        vi.mocked(validateIpcFilePath).mockRejectedValueOnce(
            new Error("Path must be absolute"),
        );

        await expect(
            ipcHandlers.get("peek-bam")?.(undefined, "relative/sample.bam"),
        ).rejects.toThrow("Path must be absolute");

        expect(vi.mocked(peekBam)).not.toHaveBeenCalled();
    });

    it.each([
        "",
        123,
    ])("rejects invalid request argument %s", async (bamPath) => {
        await expect(
            ipcHandlers.get("peek-bam")?.(undefined, bamPath),
        ).rejects.toThrow("bamPath must be a non-empty string");

        expect(vi.mocked(peekBam)).not.toHaveBeenCalled();
    });
});
