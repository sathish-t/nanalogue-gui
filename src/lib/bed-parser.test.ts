// Unit tests for BED file parser

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBedFile } from "./bed-parser";

/**
 * Creates a temporary BED file with the given content and returns its path.
 *
 * @param content - The BED file content to write.
 * @returns The filesystem path to the temporary BED file.
 */
function writeTempBed(content: string): string {
    const path = join(tmpdir(), `test-${Date.now()}-${Math.random()}.bed`);
    writeFileSync(path, content, "utf-8");
    return path;
}

describe("parseBedFile", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("parses a valid BED file", () => {
        const path = writeTempBed(
            "chr1\t100\t200\tread1\nchr2\t300\t400\tread2",
        );
        const result = parseBedFile(path);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            contig: "chr1",
            start: 100,
            end: 200,
            readId: "read1",
            rawLine: "chr1\t100\t200\tread1",
        });
    });

    it("skips comment lines", () => {
        const path = writeTempBed("# header\nchr1\t100\t200\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(1);
    });

    it("skips lines with insufficient columns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\t100\t200\nchr1\t100\t200\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("insufficient columns"),
        );
    });

    it("skips lines with NaN coordinates", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\tabc\t200\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("invalid start/end"),
        );
    });

    it("skips lines with negative start coordinate", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\t-10\t200\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines with negative end coordinate", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\t10\t-5\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines where start equals end", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\t100\t100\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("skips lines where start is greater than end", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const path = writeTempBed("chr1\t300\t100\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("0 <= start < end"),
        );
    });

    it("accepts start=0 as valid", () => {
        const path = writeTempBed("chr1\t0\t100\tread1");
        const result = parseBedFile(path);
        expect(result).toHaveLength(1);
        expect(result[0].start).toBe(0);
    });
});
