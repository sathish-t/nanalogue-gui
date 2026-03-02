// Unit tests for BED file parser

import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBedFile } from "./bed-parser";

/** Paths of temporary files created during the current test, removed in afterEach. */
const tempFiles: string[] = [];

afterEach(async () => {
    await Promise.all(tempFiles.map((p) => unlink(p).catch(() => {})));
    tempFiles.length = 0;
});

/**
 * Creates a temporary BED file with the given content and returns its path.
 * The file is registered for cleanup after each test.
 *
 * @param content - The BED file content to write.
 * @returns The filesystem path to the temporary BED file.
 */
async function writeTempBed(content: string): Promise<string> {
    const path = join(tmpdir(), `test-${Date.now()}-${Math.random()}.bed`);
    await writeFile(path, content, "utf-8");
    tempFiles.push(path);
    return path;
}

describe("parseBedFile", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("parses a valid BED file", async () => {
        const path = await writeTempBed(
            "chr1\t100\t200\tread1\nchr2\t300\t400\tread2",
        );
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(2);
        expect(result.annotations[0]).toEqual({
            contig: "chr1",
            start: 100,
            end: 200,
            readId: "read1",
            rawLine: "chr1\t100\t200\tread1",
        });
    });

    it("skips comment lines", async () => {
        const path = await writeTempBed("# header\nchr1\t100\t200\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(1);
    });

    it("skips track header lines", async () => {
        const path = await writeTempBed(
            "track name=example\nchr1\t100\t200\tread1",
        );
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(1);
    });

    it("skips browser header lines", async () => {
        const path = await writeTempBed(
            "browser position chr1:100-200\nchr1\t100\t200\tread1",
        );
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(1);
    });

    it("does not skip contigs starting with track or browser", async () => {
        const path = await writeTempBed(
            "track1\t100\t200\tread1\nbrowserX\t300\t400\tread2",
        );
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(2);
        expect(result.annotations[0].contig).toBe("track1");
        expect(result.annotations[1].contig).toBe("browserX");
    });

    it("skips lines with insufficient columns", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed(
            "chr1\t100\t200\nchr1\t100\t200\tread1",
        );
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("insufficient columns"),
        );
    });

    it("skips lines with NaN coordinates", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed("chr1\tabc\t200\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("invalid start/end"),
        );
    });

    it("skips lines with negative start coordinate", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed("chr1\t-10\t200\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines with negative end coordinate", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed("chr1\t10\t-5\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines where start equals end", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed("chr1\t100\t100\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines where start is greater than end", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = await writeTempBed("chr1\t300\t100\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("accepts start=0 as valid", async () => {
        const path = await writeTempBed("chr1\t0\t100\tread1");
        const result = parseBedFile(path);
        expect(result.annotations).toHaveLength(1);
        expect(result.annotations[0].start).toBe(0);
    });
});

describe("parseBedFile with maxEntries", () => {
    it("returns capped: false when entries are within limit", async () => {
        const path = await writeTempBed(
            "chr1\t100\t200\tread1\nchr2\t300\t400\tread2",
        );
        const result = parseBedFile(path, 10);
        expect(result.capped).toBe(false);
        expect(result.annotations).toHaveLength(2);
    });

    it("returns capped: true when entries exceed limit", async () => {
        const lines = Array.from(
            { length: 15 },
            (_, i) => `chr1\t${i * 100}\t${(i + 1) * 100}\tread${i}`,
        ).join("\n");
        const path = await writeTempBed(lines);
        const result = parseBedFile(path, 10);
        expect(result.capped).toBe(true);
        expect(result.annotations).toHaveLength(10);
    });

    it("uses default maxEntries of 10000", async () => {
        const path = await writeTempBed("chr1\t100\t200\tread1");
        const result = parseBedFile(path);
        expect(result.capped).toBe(false);
    });
});
