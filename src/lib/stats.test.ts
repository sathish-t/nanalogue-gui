// Unit tests for statistics utilities

import { describe, expect, it } from "vitest";
import { binHistogram, binYield, calculateStats } from "./stats";

describe("calculateStats", () => {
    it("returns zeroed stats for empty input", () => {
        const result = calculateStats([]);
        expect(result.count).toBe(0);
        expect(result.sum).toBe(0);
        expect(result.mean).toBe(0);
        expect(result.min).toBe(0);
        expect(result.max).toBe(0);
    });

    it("computes correct stats for a simple dataset", () => {
        const result = calculateStats([1, 2, 3, 4, 5]);
        expect(result.count).toBe(5);
        expect(result.sum).toBe(15);
        expect(result.mean).toBe(3);
        expect(result.min).toBe(1);
        expect(result.max).toBe(5);
        expect(result.p50).toBe(3);
    });

    it("computes N50 when requested", () => {
        const result = calculateStats([100, 200, 300], true);
        expect(result.n50).toBeDefined();
        expect(typeof result.n50).toBe("number");
    });

    it("omits N50 when not requested", () => {
        const result = calculateStats([100, 200, 300], false);
        expect(result.n50).toBeUndefined();
    });

    it("handles a single-element dataset", () => {
        const result = calculateStats([42]);
        expect(result.count).toBe(1);
        expect(result.mean).toBe(42);
        expect(result.min).toBe(42);
        expect(result.max).toBe(42);
        expect(result.stddev).toBe(0);
    });
});

describe("binHistogram", () => {
    it("returns empty array for empty input", () => {
        expect(binHistogram([], 10)).toEqual([]);
    });

    it("returns empty array for zero bin size", () => {
        expect(binHistogram([1, 2, 3], 0)).toEqual([]);
    });

    it("returns empty array for negative bin size", () => {
        expect(binHistogram([1, 2, 3], -5)).toEqual([]);
    });

    it("bins values into correct buckets", () => {
        const result = binHistogram([1, 5, 10, 15, 20], 10);
        expect(result.length).toBeGreaterThan(0);

        const totalCount = result.reduce((sum, bin) => sum + bin.count, 0);
        expect(totalCount).toBe(5);
    });

    it("respects explicit min/max range", () => {
        const result = binHistogram([0.1, 0.5, 0.9], 0.5, 0, 1);
        expect(result.length).toBe(2);
        expect(result[0].binStart).toBe(0);
        expect(result[1].binEnd).toBe(1);
    });

    it("handles large arrays without stack overflow", () => {
        const largeArray = Array.from({ length: 200_000 }, (_, i) => i);
        const result = binHistogram(largeArray, 50_000);
        expect(result.length).toBe(4);
        const totalCount = result.reduce((sum, bin) => sum + bin.count, 0);
        expect(totalCount).toBe(200_000);
    });
});

describe("binYield", () => {
    it("returns empty array for empty input", () => {
        expect(binYield([], 10)).toEqual([]);
    });

    it("returns empty array for zero bin size", () => {
        expect(binYield([100, 200], 0)).toEqual([]);
    });

    it("returns empty array for negative bin size", () => {
        expect(binYield([100, 200], -10)).toEqual([]);
    });

    it("sums yield correctly within bins", () => {
        const result = binYield([100, 200, 300], 500);
        expect(result.length).toBe(1);
        expect(result[0].yield).toBe(600);
    });

    it("distributes yield across multiple bins", () => {
        const result = binYield([100, 600], 500);
        expect(result.length).toBe(2);
        expect(result[0].yield).toBe(100);
        expect(result[1].yield).toBe(600);
    });

    it("returns one bin for all-zero lengths", () => {
        const result = binYield([0, 0, 0], 500);
        expect(result.length).toBe(1);
        expect(result[0].yield).toBe(0);
    });

    it("handles large arrays without stack overflow", () => {
        const largeArray = Array.from({ length: 200_000 }, (_, i) => i + 1);
        const result = binYield(largeArray, 50_000);
        expect(result.length).toBe(4);
        const totalYield = result.reduce((sum, bin) => sum + bin.yield, 0);
        const expectedYield = (200_000 * 200_001) / 2;
        expect(totalYield).toBe(expectedYield);
    });
});
