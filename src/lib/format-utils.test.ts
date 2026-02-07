// Tests for pure formatting and trimming utility functions.

import { describe, expect, it } from "vitest";
import {
    formatContigLength,
    formatNumber,
    formatYieldLabel,
    trimZeroHistogramBins,
    trimZeroYieldBins,
} from "./format-utils";
import type { HistogramBin, YieldBin } from "./stats";

/**
 * Creates a histogram bin with the given start, end, and count.
 *
 * @param binStart - Inclusive lower bound.
 * @param binEnd - Exclusive upper bound.
 * @param count - Observation count.
 * @returns The histogram bin.
 */
function hbin(binStart: number, binEnd: number, count: number): HistogramBin {
    return { binStart, binEnd, count };
}

/**
 * Creates a yield bin with the given start, end, and yield.
 *
 * @param binStart - Inclusive lower bound.
 * @param binEnd - Exclusive upper bound.
 * @param yieldVal - Total yield in bases.
 * @returns The yield bin.
 */
function ybin(binStart: number, binEnd: number, yieldVal: number): YieldBin {
    return { binStart, binEnd, yield: yieldVal };
}

describe("trimZeroHistogramBins", () => {
    it("returns empty array unchanged", () => {
        expect(trimZeroHistogramBins([])).toEqual([]);
    });

    it("returns bins unchanged when no leading or trailing zeros", () => {
        const bins = [hbin(0, 10, 5), hbin(10, 20, 3)];
        expect(trimZeroHistogramBins(bins)).toEqual(bins);
    });

    it("trims leading zero-count bins", () => {
        const bins = [hbin(0, 10, 0), hbin(10, 20, 0), hbin(20, 30, 5)];
        expect(trimZeroHistogramBins(bins)).toEqual([hbin(20, 30, 5)]);
    });

    it("trims trailing zero-count bins", () => {
        const bins = [hbin(0, 10, 5), hbin(10, 20, 0), hbin(20, 30, 0)];
        expect(trimZeroHistogramBins(bins)).toEqual([hbin(0, 10, 5)]);
    });

    it("trims both leading and trailing zero-count bins", () => {
        const bins = [
            hbin(0, 10, 0),
            hbin(10, 20, 3),
            hbin(20, 30, 7),
            hbin(30, 40, 0),
        ];
        expect(trimZeroHistogramBins(bins)).toEqual([
            hbin(10, 20, 3),
            hbin(20, 30, 7),
        ]);
    });

    it("preserves interior zero-count bins", () => {
        const bins = [hbin(0, 10, 2), hbin(10, 20, 0), hbin(20, 30, 4)];
        expect(trimZeroHistogramBins(bins)).toEqual(bins);
    });

    it("returns a single non-zero bin unchanged", () => {
        const bins = [hbin(0, 10, 1)];
        expect(trimZeroHistogramBins(bins)).toEqual(bins);
    });

    it("trims a single zero-count bin to empty", () => {
        const bins = [hbin(0, 10, 0)];
        const result = trimZeroHistogramBins(bins);
        expect(result).toEqual([]);
    });
});

describe("trimZeroYieldBins", () => {
    it("returns empty array unchanged", () => {
        expect(trimZeroYieldBins([])).toEqual([]);
    });

    it("returns bins unchanged when no leading or trailing zeros", () => {
        const bins = [ybin(0, 10, 500), ybin(10, 20, 300)];
        expect(trimZeroYieldBins(bins)).toEqual(bins);
    });

    it("trims leading zero-yield bins", () => {
        const bins = [ybin(0, 10, 0), ybin(10, 20, 0), ybin(20, 30, 500)];
        expect(trimZeroYieldBins(bins)).toEqual([ybin(20, 30, 500)]);
    });

    it("trims trailing zero-yield bins", () => {
        const bins = [ybin(0, 10, 500), ybin(10, 20, 0), ybin(20, 30, 0)];
        expect(trimZeroYieldBins(bins)).toEqual([ybin(0, 10, 500)]);
    });

    it("preserves interior zero-yield bins", () => {
        const bins = [ybin(0, 10, 200), ybin(10, 20, 0), ybin(20, 30, 400)];
        expect(trimZeroYieldBins(bins)).toEqual(bins);
    });
});

describe("formatNumber", () => {
    it("formats millions with M suffix", () => {
        expect(formatNumber(1_000_000)).toBe("1.00M");
        expect(formatNumber(2_500_000)).toBe("2.50M");
        expect(formatNumber(10_000_000)).toBe("10.00M");
    });

    it("formats thousands with K suffix", () => {
        expect(formatNumber(1_000)).toBe("1.00K");
        expect(formatNumber(2_500)).toBe("2.50K");
        expect(formatNumber(999_999)).toBe("1000.00K");
    });

    it("formats small numbers with decimal places", () => {
        expect(formatNumber(0)).toBe("0.00");
        expect(formatNumber(1)).toBe("1.00");
        expect(formatNumber(999)).toBe("999.00");
        expect(formatNumber(0.5)).toBe("0.50");
    });

    it("respects custom decimal places", () => {
        expect(formatNumber(1_500_000, 0)).toBe("2M");
        expect(formatNumber(1_500_000, 1)).toBe("1.5M");
        expect(formatNumber(1_500, 0)).toBe("2K");
        expect(formatNumber(1_500, 1)).toBe("1.5K");
        expect(formatNumber(42, 0)).toBe("42");
        expect(formatNumber(42, 3)).toBe("42.000");
    });

    it("uses 2 decimal places by default", () => {
        expect(formatNumber(3_141)).toBe("3.14K");
    });
});

describe("formatContigLength", () => {
    it("formats megabase lengths", () => {
        expect(formatContigLength(1_000_000)).toBe("1.00 Mb");
        expect(formatContigLength(2_500_000)).toBe("2.50 Mb");
        expect(formatContigLength(248_956_422)).toBe("248.96 Mb");
    });

    it("formats kilobase lengths", () => {
        expect(formatContigLength(1_000)).toBe("1.0 kb");
        expect(formatContigLength(50_000)).toBe("50.0 kb");
        expect(formatContigLength(999_999)).toBe("1000.0 kb");
    });

    it("formats base pair lengths", () => {
        expect(formatContigLength(1)).toBe("1 bp");
        expect(formatContigLength(500)).toBe("500 bp");
        expect(formatContigLength(999)).toBe("999 bp");
    });

    it("formats zero as base pairs", () => {
        expect(formatContigLength(0)).toBe("0 bp");
    });
});

describe("formatYieldLabel", () => {
    it("uses formatNumber with 0 decimals for binWidth >= 1000", () => {
        expect(formatYieldLabel(0, 1000)).toBe("0");
        expect(formatYieldLabel(1_000, 1000)).toBe("1K");
        expect(formatYieldLabel(1_000_000, 1000)).toBe("1M");
        expect(formatYieldLabel(5_000, 10000)).toBe("5K");
    });

    it("uses 1-decimal SI suffixes for binWidth >= 100", () => {
        expect(formatYieldLabel(1_000_000, 100)).toBe("1.0M");
        expect(formatYieldLabel(2_500_000, 500)).toBe("2.5M");
        expect(formatYieldLabel(1_000, 100)).toBe("1.0K");
        expect(formatYieldLabel(500, 100)).toBe("500");
    });

    it("uses toLocaleString for binWidth <= 10", () => {
        const result = formatYieldLabel(1_000, 10);
        // toLocaleString output is locale-dependent; just check it's a string
        expect(typeof result).toBe("string");
        expect(result).toContain("1");
    });

    it("returns raw number string for small values with binWidth 100", () => {
        expect(formatYieldLabel(0, 100)).toBe("0");
        expect(formatYieldLabel(42, 100)).toBe("42");
    });
});
