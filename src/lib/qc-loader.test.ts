// Unit tests for QC loader utilities

import { describe, expect, it } from "vitest";
import { RunningHistogram } from "./histogram";
import { maxReadLengthForBinWidth, parseWindowedDensities } from "./qc-loader";

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
