// Unit tests for qc-data-loader utilities

import { describe, expect, it } from "vitest";
import { RunningHistogram } from "./histogram";
import {
    computeAvgQuality,
    maxReadLengthForBinWidth,
    parseSeqTableTsv,
    parseWindowedDensities,
    regionSizeBp,
} from "./qc-data-loader";

describe("parseWindowedDensities", () => {
    it("returns empty array for empty input", () => {
        expect(parseWindowedDensities("")).toEqual([]);
    });

    it("returns empty array for header-only input", () => {
        expect(parseWindowedDensities("col1\tcol2\tcol3\tcol4\tcol5")).toEqual(
            [],
        );
    });

    it("parses valid density values from TSV", () => {
        const tsv = [
            "contig\tstart\tend\tread_id\twin_val",
            "chr1\t100\t200\tread1\t0.5",
            "chr1\t200\t300\tread1\t0.75",
        ].join("\n");

        const result = parseWindowedDensities(tsv);
        expect(result).toEqual([0.5, 0.75]);
    });

    it("filters out NaN values", () => {
        const tsv = [
            "contig\tstart\tend\tread_id\twin_val",
            "chr1\t100\t200\tread1\t0.5",
            "chr1\t200\t300\tread1\tNaN",
            "chr1\t300\t400\tread1\t0.75",
        ].join("\n");

        const result = parseWindowedDensities(tsv);
        expect(result).toEqual([0.5, 0.75]);
    });

    it("filters out Infinity values", () => {
        const tsv = [
            "contig\tstart\tend\tread_id\twin_val",
            "chr1\t100\t200\tread1\t0.5",
            "chr1\t200\t300\tread1\tInfinity",
            "chr1\t300\t400\tread1\t-Infinity",
            "chr1\t400\t500\tread1\t0.75",
        ].join("\n");

        const result = parseWindowedDensities(tsv);
        expect(result).toEqual([0.5, 0.75]);
    });

    it("skips rows with fewer than 5 fields", () => {
        const tsv = [
            "contig\tstart\tend\tread_id\twin_val",
            "chr1\t100\t200\tread1\t0.5",
            "chr1\t200\t300",
            "chr1\t300\t400\tread1\t0.75",
        ].join("\n");

        const result = parseWindowedDensities(tsv);
        expect(result).toEqual([0.5, 0.75]);
    });
});

describe("maxReadLengthForBinWidth", () => {
    it("returns 30M for binWidth >= 10000", () => {
        expect(maxReadLengthForBinWidth(10_000)).toBe(30_000_000);
        expect(maxReadLengthForBinWidth(50_000)).toBe(30_000_000);
    });

    it("returns 3M for binWidth >= 1000 and < 10000", () => {
        expect(maxReadLengthForBinWidth(1000)).toBe(3_000_000);
        expect(maxReadLengthForBinWidth(5000)).toBe(3_000_000);
        expect(maxReadLengthForBinWidth(9999)).toBe(3_000_000);
    });

    it("returns 300K for binWidth >= 10 and < 1000", () => {
        expect(maxReadLengthForBinWidth(10)).toBe(300_000);
        expect(maxReadLengthForBinWidth(100)).toBe(300_000);
        expect(maxReadLengthForBinWidth(999)).toBe(300_000);
    });

    it("returns 30K for binWidth < 10", () => {
        expect(maxReadLengthForBinWidth(1)).toBe(30_000);
        expect(maxReadLengthForBinWidth(9)).toBe(30_000);
    });
});

describe("probability normalization", () => {
    it("normalizes raw 0-255 probabilities into 0-1 range", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        const rawValues = [0, 1, 127, 128, 254, 255];

        for (const raw of rawValues) {
            const normalized = Math.min(raw / 255, 1 - Number.EPSILON);
            hist.add(normalized);
        }

        expect(hist.count).toBe(6);
        expect(hist.exceededCount).toBe(0);

        const bins = hist.toBins();
        for (const bin of bins) {
            expect(bin.binStart).toBeGreaterThanOrEqual(0);
            expect(bin.binEnd).toBeLessThanOrEqual(1.0);
        }
    });

    it("maps raw 255 into the last bin [0.99, 1.00]", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        const normalized = Math.min(255 / 255, 1 - Number.EPSILON);
        hist.add(normalized);

        const bins = hist.toBins();
        const lastBin = bins[bins.length - 1];
        expect(lastBin.binStart).toBeCloseTo(0.99, 9);
        expect(lastBin.count).toBe(1);
        expect(hist.exceededCount).toBe(0);
    });

    it("maps raw 0 into the first bin [0, 0.01)", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        hist.add(Math.min(0 / 255, 1 - Number.EPSILON));

        const bins = hist.toBins();
        expect(bins[0].binStart).toBe(0);
        expect(bins[0].count).toBe(1);
    });

    it("produces 100 bins for a full 0-1 range histogram", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        // Add one value in each bin
        for (let raw = 0; raw <= 255; raw++) {
            hist.add(Math.min(raw / 255, 1 - Number.EPSILON));
        }

        const bins = hist.toBins();
        expect(bins.length).toBe(100);
    });
});

describe("parseSeqTableTsv", () => {
    /** Verifies basic TSV parsing of read_id, sequence, and qualities columns. */
    it("parses a simple two-row TSV", () => {
        const tsv = [
            "read_id\tsequence\tqualities",
            "read1\tACGT\t10.20.30.40",
            "read2\tTGCA\t5.255.15.25",
        ].join("\n");

        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(2);
        expect(rows[0].readId).toBe("read1");
        expect(rows[0].sequence).toBe("ACGT");
        expect(rows[0].qualities).toEqual([10, 20, 30, 40]);
        expect(rows[1].readId).toBe("read2");
        expect(rows[1].qualities).toEqual([5, 255, 15, 25]);
    });

    /** Verifies that a header-only TSV returns an empty array. */
    it("returns empty array for header-only TSV", () => {
        const tsv = "read_id\tsequence\tqualities";
        expect(parseSeqTableTsv(tsv)).toEqual([]);
    });

    /** Verifies that an empty string returns an empty array. */
    it("returns empty array for empty string", () => {
        expect(parseSeqTableTsv("")).toEqual([]);
    });

    /** Verifies trailing newlines are handled correctly. */
    it("handles trailing newlines", () => {
        const tsv =
            "read_id\tsequence\tqualities\nread1\tACGT\t10.20.30.40\n\n";
        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(1);
    });
});

describe("computeAvgQuality", () => {
    /** Verifies probability-based average excluding 255 values. */
    it("computes probability-based average excluding 255 values", () => {
        // [10, 20, 30]: min=10, sum=10^0+10^-1+10^-2=1.11, 10+round(-10*log10(1.11/3))=14
        expect(computeAvgQuality([10, 20, 255, 30])).toBe(14);
    });

    /** Verifies null is returned when all values are 255. */
    it("returns null when all values are 255", () => {
        expect(computeAvgQuality([255, 255, 255])).toBeNull();
    });

    /** Verifies null for empty array. */
    it("returns null for empty array", () => {
        expect(computeAvgQuality([])).toBeNull();
    });

    /** Verifies single non-255 value returns that value unchanged. */
    it("handles single value", () => {
        expect(computeAvgQuality([42])).toBe(42);
    });

    /** Verifies identical values return the same value. */
    it("returns same value when all qualities are equal", () => {
        expect(computeAvgQuality([15, 15, 15])).toBe(15);
    });
});

describe("regionSizeBp", () => {
    /** Returns size for a valid range region. */
    it("returns size for contig:start-end", () => {
        expect(regionSizeBp("chr1:100-600")).toBe(500);
    });

    /** Returns null for bare contig name (no range). */
    it("returns null for bare contig name", () => {
        expect(regionSizeBp("chr1")).toBeNull();
    });

    /** Returns null for undefined. */
    it("returns null for undefined", () => {
        expect(regionSizeBp(undefined)).toBeNull();
    });

    /** Returns size of 1 for a 1-bp region. */
    it("returns 1 for chr1:100-101", () => {
        expect(regionSizeBp("chr1:100-101")).toBe(1);
    });
});
