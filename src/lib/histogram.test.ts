// Unit tests for RunningHistogram streaming accumulator

import { describe, expect, it } from "vitest";
import { RunningHistogram } from "./histogram";

describe("RunningHistogram", () => {
    describe("basic accumulation", () => {
        it("starts with zero count", () => {
            const h = new RunningHistogram(10, 1000);
            expect(h.count).toBe(0);
        });

        it("counts added values", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(5);
            h.add(15);
            h.add(25);
            expect(h.count).toBe(3);
        });

        it("tracks min and max", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(50);
            h.add(10);
            h.add(30);
            expect(h.min).toBe(10);
            expect(h.max).toBe(50);
        });

        it("computes correct sum", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(10);
            h.add(20);
            h.add(30);
            expect(h.sum).toBe(60);
        });
    });

    describe("binning", () => {
        it("bins values correctly with binWidth=10", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(5); // bin 0: [0, 10)
            h.add(15); // bin 1: [10, 20)
            h.add(25); // bin 2: [20, 30)
            h.add(7); // bin 0: [0, 10)
            const bins = h.toBins();

            // Dense array includes all bins from 0 to maxValue
            expect(bins.length).toBe(100);
            expect(bins[0]).toEqual({ binStart: 0, binEnd: 10, count: 2 });
            expect(bins[1]).toEqual({ binStart: 10, binEnd: 20, count: 1 });
            expect(bins[2]).toEqual({ binStart: 20, binEnd: 30, count: 1 });
            expect(bins[3].count).toBe(0);
        });

        it("bins probability values with binWidth=0.01", () => {
            const h = new RunningHistogram(0.01, 1.01);
            h.add(0.005); // bin 0: [0, 0.01)
            h.add(0.015); // bin 1: [0.01, 0.02)
            h.add(0.995); // bin 99: [0.99, 1.00)

            const bins = h.toBins();
            expect(bins[0]).toEqual({ binStart: 0, binEnd: 0.01, count: 1 });
            expect(bins[1]).toEqual({ binStart: 0.01, binEnd: 0.02, count: 1 });
            expect(bins[99].count).toBe(1);
        });

        it("returns empty array when no values added", () => {
            const h = new RunningHistogram(10, 1000);
            expect(h.toBins()).toEqual([]);
        });

        it("returns sorted bins", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(90);
            h.add(10);
            h.add(50);

            const bins = h.toBins();
            for (let i = 1; i < bins.length; i++) {
                expect(bins[i].binStart).toBeGreaterThan(bins[i - 1].binStart);
            }
        });

        it("bins 0.47 correctly with binWidth=0.01 (floating-point stability)", () => {
            // 0.47 / 0.01 = 46.99999... which Math.floor rounds to 46
            // Multiplying by inverse (0.47 * 100 = 47) gives the correct bin
            const h = new RunningHistogram(0.01, 1.01);
            h.add(0.47);
            const bins = h.toBins();
            expect(bins[47].count).toBe(1);
            expect(bins[47].binStart).toBeCloseTo(0.47, 9);
        });

        it("bins 1.0 deterministically with binWidth=0.01", () => {
            const h = new RunningHistogram(0.01, 1.01);
            h.add(1.0);
            h.add(1.0);
            const bins = h.toBins();
            // Both calls should land in bin 100: [1.00, 1.01)
            expect(bins[100].count).toBe(2);
        });

        it("produces deterministic bins for repeated identical values", () => {
            const h = new RunningHistogram(0.01, 1.01);
            for (let i = 0; i < 100; i++) {
                h.add(0.3);
            }
            const bins = h.toBins();
            // All 100 values should land in the same bin (bin 30: [0.30, 0.31))
            expect(bins[30].count).toBe(100);
        });

        it("counts negative values as exceeded", () => {
            const h = new RunningHistogram(10, 1000);
            h.add(-5);
            h.add(5);

            expect(h.exceededCount).toBe(1);
            expect(h.count).toBe(2);
            const bins = h.toBins();
            expect(bins[0]).toEqual({ binStart: 0, binEnd: 10, count: 1 });
        });
    });

    describe("toStats", () => {
        it("returns zeroed stats for empty histogram", () => {
            const h = new RunningHistogram(10, 1000);
            const stats = h.toStats(false);
            expect(stats.count).toBe(0);
            expect(stats.sum).toBe(0);
            expect(stats.mean).toBe(0);
            expect(stats.min).toBe(0);
            expect(stats.max).toBe(0);
            expect(stats.stddev).toBe(0);
        });

        it("computes correct mean", () => {
            const h = new RunningHistogram(1, 1000);
            h.add(10);
            h.add(20);
            h.add(30);
            const stats = h.toStats(false);
            expect(stats.mean).toBe(20);
        });

        it("computes correct stddev", () => {
            const h = new RunningHistogram(1, 1000);
            // All same value => stddev = 0
            h.add(5);
            h.add(5);
            h.add(5);
            const stats = h.toStats(false);
            expect(stats.stddev).toBe(0);
        });

        it("approximates percentiles from bins", () => {
            const h = new RunningHistogram(1, 1000);
            // Add 1..100 so p50 should be ~50
            for (let i = 1; i <= 100; i++) {
                h.add(i);
            }
            const stats = h.toStats(false);

            // With bin width 1, approximation should be very close
            expect(stats.p50).toBeGreaterThanOrEqual(49);
            expect(stats.p50).toBeLessThanOrEqual(51);
            expect(stats.p10).toBeGreaterThanOrEqual(9);
            expect(stats.p10).toBeLessThanOrEqual(11);
            expect(stats.p90).toBeGreaterThanOrEqual(89);
            expect(stats.p90).toBeLessThanOrEqual(91);
        });

        it("computes N50 when requested", () => {
            const h = new RunningHistogram(1, 1000);
            h.add(100);
            h.add(200);
            h.add(300);
            const stats = h.toStats(true);
            expect(stats.n50).toBeDefined();
            expect(typeof stats.n50).toBe("number");
        });

        it("omits N50 when not requested", () => {
            const h = new RunningHistogram(1, 1000);
            h.add(100);
            const stats = h.toStats(false);
            expect(stats.n50).toBeUndefined();
        });
    });

    describe("toYieldBins", () => {
        it("returns empty array when no values added", () => {
            const h = new RunningHistogram(10, 1000);
            expect(h.toYieldBins()).toEqual([]);
        });

        it("computes yield per bin correctly", () => {
            const h = new RunningHistogram(100, 1000);
            h.add(50); // bin 0: yield += 50
            h.add(75); // bin 0: yield += 75
            h.add(150); // bin 1: yield += 150

            const bins = h.toYieldBins();
            expect(bins[0].yield).toBe(125);
            expect(bins[1].yield).toBe(150);
        });

        it("returns sorted bins", () => {
            const h = new RunningHistogram(100, 1000);
            h.add(500);
            h.add(100);

            const bins = h.toYieldBins();
            for (let i = 1; i < bins.length; i++) {
                expect(bins[i].binStart).toBeGreaterThan(bins[i - 1].binStart);
            }
        });
    });
});
