// Streaming histogram accumulator for binning data without storing raw arrays

import type { HistogramBin, Stats, YieldBin } from "./stats";

/**
 * A streaming histogram that bins values into a dense, pre-allocated array
 * and tracks running statistics, avoiding the need to store raw values.
 */
export class RunningHistogram {
    /** The width of each histogram bin. */
    private readonly binWidth: number;
    /** Precomputed inverse of bin width to avoid floating-point division errors. */
    private readonly inverseBinWidth: number;
    /** The total number of bins in the dense array. */
    private readonly numBins: number;
    /** Dense array of observation counts per bin. */
    private readonly counts: number[];
    /** Dense array of cumulative yield per bin. */
    private readonly yields: number[];
    /** Running count of values added. */
    private _count = 0;
    /** Running sum of values added. */
    private _sum = 0;
    /** Running sum of squared values for variance calculation. */
    private _sumOfSquares = 0;
    /** Running minimum value seen. */
    private _min = Number.POSITIVE_INFINITY;
    /** Running maximum value seen. */
    private _max = Number.NEGATIVE_INFINITY;
    /** Count of values that exceeded the maximum representable value. */
    private _exceededCount = 0;

    /**
     * Creates a streaming histogram with the specified bin width and maximum value.
     *
     * @param binWidth - The width of each histogram bin.
     * @param maxValue - The maximum value the histogram can represent.
     */
    constructor(binWidth: number, maxValue: number) {
        this.binWidth = binWidth;
        this.inverseBinWidth = 1 / binWidth;
        this.numBins = Math.ceil(maxValue / binWidth);
        this.counts = new Array<number>(this.numBins).fill(0);
        this.yields = new Array<number>(this.numBins).fill(0);
    }

    /**
     * The total number of values added.
     *
     * @returns The count of values accumulated so far.
     */
    get count(): number {
        return this._count;
    }

    /**
     * The sum of all added values.
     *
     * @returns The cumulative sum of all values.
     */
    get sum(): number {
        return this._sum;
    }

    /**
     * The minimum value added, or zero if no values have been added.
     *
     * @returns The minimum value.
     */
    get min(): number {
        return this._count === 0 ? 0 : this._min;
    }

    /**
     * The maximum value added, or zero if no values have been added.
     *
     * @returns The maximum value.
     */
    get max(): number {
        return this._count === 0 ? 0 : this._max;
    }

    /**
     * The count of values that exceeded the maximum representable value.
     *
     * @returns The number of values that were too large for the histogram.
     */
    get exceededCount(): number {
        return this._exceededCount;
    }

    /**
     * Adds a value to the histogram, updating the appropriate bin and running statistics.
     * Values exceeding the maximum are counted but not binned.
     *
     * @param value - The numeric value to add.
     */
    add(value: number): void {
        this._count++;
        this._sum += value;
        this._sumOfSquares += value * value;

        if (value < this._min) this._min = value;
        if (value > this._max) this._max = value;

        const binIndex = Math.floor(value * this.inverseBinWidth);

        if (binIndex < 0 || binIndex >= this.numBins) {
            this._exceededCount++;
            return;
        }

        this.counts[binIndex]++;
        this.yields[binIndex] += value;
    }

    /**
     * Returns the dense array of histogram bins from 0 to maxValue.
     *
     * @returns A complete array of histogram bins including zero-count bins.
     */
    toBins(): HistogramBin[] {
        if (this._count === 0) return [];

        return this.counts.map((count, i) => ({
            binStart: i * this.binWidth,
            binEnd: (i + 1) * this.binWidth,
            count,
        }));
    }

    /**
     * Returns the dense array of yield bins from 0 to maxValue.
     *
     * @returns A complete array of yield bins including zero-yield bins.
     */
    toYieldBins(): YieldBin[] {
        if (this._count === 0) return [];

        return this.yields.map((yieldVal, i) => ({
            binStart: i * this.binWidth,
            binEnd: (i + 1) * this.binWidth,
            yield: yieldVal,
        }));
    }

    /**
     * Computes descriptive statistics from the running accumulators and bin data.
     *
     * Percentiles are approximated by walking the dense bins until the
     * cumulative count reaches the target fraction. The returned value is the
     * midpoint of the bin containing the target percentile.
     *
     * @param calculateN50 - Whether to include N50 in the returned stats.
     * @returns A Stats object with count, sum, min, max, mean, stddev, percentiles, and optionally N50.
     */
    toStats(calculateN50: boolean): Stats {
        if (this._count === 0) {
            return {
                count: 0,
                sum: 0,
                min: 0,
                max: 0,
                mean: 0,
                p10: 0,
                p50: 0,
                p90: 0,
                stddev: 0,
            };
        }

        const mean = this._sum / this._count;
        const variance = this._sumOfSquares / this._count - mean * mean;
        const stddev = Math.sqrt(Math.max(0, variance));

        const stats: Stats = {
            count: this._count,
            sum: this._sum,
            min: this._min,
            max: this._max,
            mean,
            p10: this.approximatePercentile(10),
            p50: this.approximatePercentile(50),
            p90: this.approximatePercentile(90),
            stddev,
        };

        if (calculateN50) {
            stats.n50 = this.approximateN50();
        }

        return stats;
    }

    /**
     * Approximates a percentile by walking the dense bins until the cumulative
     * count reaches the target fraction.
     *
     * @param p - The percentile to compute (0-100).
     * @returns The midpoint of the bin containing the target percentile.
     */
    private approximatePercentile(p: number): number {
        const target = (p / 100) * this._count;
        let cumulative = 0;

        for (let i = 0; i < this.numBins; i++) {
            cumulative += this.counts[i];
            if (cumulative >= target) {
                return (i + 0.5) * this.binWidth;
            }
        }

        // Fallback: return last bin midpoint
        return (this.numBins - 0.5) * this.binWidth;
    }

    /**
     * Approximates N50 by walking bins from smallest to largest,
     * accumulating yield until 50% of total yield is reached.
     *
     * @returns The midpoint of the bin where cumulative yield reaches 50%.
     */
    private approximateN50(): number {
        const halfSum = this._sum / 2;
        let cumulativeYield = 0;

        for (let i = 0; i < this.numBins; i++) {
            cumulativeYield += this.yields[i];
            if (cumulativeYield >= halfSum) {
                return (i + 0.5) * this.binWidth;
            }
        }

        return (this.numBins - 0.5) * this.binWidth;
    }
}
