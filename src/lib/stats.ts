// Statistics utilities for QC calculations

/**
 * Descriptive statistics computed from a numeric dataset.
 */
export interface Stats {
    /** The total number of values in the dataset. */
    count: number;

    /** The sum of all values in the dataset. */
    sum: number;

    /** The minimum value in the dataset. */
    min: number;

    /** The maximum value in the dataset. */
    max: number;

    /** The arithmetic mean of the dataset. */
    mean: number;

    /** The 10th percentile value of the dataset. */
    p10: number;

    /** The 50th percentile (median) value of the dataset. */
    p50: number;

    /** The 90th percentile value of the dataset. */
    p90: number;

    /** The population standard deviation of the dataset. */
    stddev: number;

    /** The N50 value, present only when N50 calculation is requested. */
    n50?: number;
}

/**
 * Calculate descriptive statistics for an array of numeric values.
 *
 * @param values - The array of numbers to compute statistics for.
 * @param calculateN50 - Whether to include the N50 value in the result.
 * @returns A Stats object containing the computed descriptive statistics.
 */
export function calculateStats(values: number[], calculateN50 = false): Stats {
    if (values.length === 0) {
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

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / count;

    const variance =
        sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
    const stddev = Math.sqrt(variance);

    const stats: Stats = {
        count,
        sum,
        min: sorted[0],
        max: sorted[count - 1],
        mean,
        p10: percentile(sorted, 10),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        stddev,
    };

    if (calculateN50) {
        stats.n50 = computeN50(sorted);
    }

    return stats;
}

/**
 * Compute a given percentile from a pre-sorted array using linear interpolation.
 *
 * @param sorted - The array of numbers sorted in ascending order.
 * @param p - The percentile to compute, expressed as a number between 0 and 100.
 * @returns The interpolated value at the requested percentile.
 */
function percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return sorted[lower];
    }

    const fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Compute the N50 value from a pre-sorted array of lengths.
 *
 * @param sorted - The array of numbers sorted in ascending order.
 * @returns The value at which the cumulative sum reaches 50 percent of the total.
 */
function computeN50(sorted: number[]): number {
    // N50: sort ascending, cumulative sum from smallest,
    // return length where cumsum reaches 50% of total
    const total = sorted.reduce((acc, v) => acc + v, 0);
    const half = total / 2;

    let cumsum = 0;
    for (const value of sorted) {
        cumsum += value;
        if (cumsum >= half) {
            return value;
        }
    }

    return sorted[sorted.length - 1];
}

/**
 * A single bin in a histogram representing a count of values within a range.
 */
export interface HistogramBin {
    /** The inclusive lower bound of the bin. */
    binStart: number;

    /** The exclusive upper bound of the bin. */
    binEnd: number;

    /** The number of values that fall within this bin. */
    count: number;
}

/**
 * Computes the minimum value in an array using iteration instead of spread.
 *
 * @param values - The array of numbers to find the minimum of.
 * @returns The minimum value in the array.
 */
function iterativeMin(values: number[]): number {
    let min = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] < min) min = values[i];
    }
    return min;
}

/**
 * Computes the maximum value in an array using iteration instead of spread.
 *
 * @param values - The array of numbers to find the maximum of.
 * @returns The maximum value in the array.
 */
function iterativeMax(values: number[]): number {
    let max = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] > max) max = values[i];
    }
    return max;
}

/**
 * Distribute numeric values into fixed-width histogram bins and count occurrences.
 *
 * @param values - The array of numbers to bin.
 * @param binSize - The width of each histogram bin.
 * @param minVal - The optional minimum value for the first bin; defaults to the dataset minimum.
 * @param maxVal - The optional maximum value for the last bin; defaults to the dataset maximum.
 * @returns An array of HistogramBin objects representing the histogram.
 */
export function binHistogram(
    values: number[],
    binSize: number,
    minVal?: number,
    maxVal?: number,
): HistogramBin[] {
    if (values.length === 0) return [];
    if (binSize <= 0) return [];

    const min = minVal ?? iterativeMin(values);
    const max = maxVal ?? iterativeMax(values);

    const numBins = Math.max(1, Math.ceil((max - min) / binSize));
    const bins: HistogramBin[] = [];

    for (let i = 0; i < numBins; i++) {
        bins.push({
            binStart: min + i * binSize,
            binEnd: min + (i + 1) * binSize,
            count: 0,
        });
    }

    for (const value of values) {
        const binIndex = Math.min(
            Math.floor((value - min) / binSize),
            numBins - 1,
        );
        if (binIndex >= 0 && binIndex < bins.length) {
            bins[binIndex].count++;
        }
    }

    return bins;
}

/**
 * A single bin in a yield histogram representing the total bases within a range.
 */
export interface YieldBin {
    /** The inclusive lower bound of the bin. */
    binStart: number;

    /** The exclusive upper bound of the bin. */
    binEnd: number;

    /** The total yield (sum of lengths) of values that fall within this bin. */
    yield: number;
}

/**
 * Distribute read lengths into fixed-width bins and sum the yield per bin.
 *
 * @param lengths - The array of read lengths to bin.
 * @param binSize - The width of each yield bin.
 * @returns An array of YieldBin objects with cumulative yield per bin.
 */
export function binYield(lengths: number[], binSize: number): YieldBin[] {
    if (lengths.length === 0) return [];
    if (binSize <= 0) return [];

    const max = iterativeMax(lengths);
    const numBins = Math.max(1, Math.ceil(max / binSize));
    const bins: YieldBin[] = [];

    for (let i = 0; i < numBins; i++) {
        bins.push({
            binStart: i * binSize,
            binEnd: (i + 1) * binSize,
            yield: 0,
        });
    }

    for (const length of lengths) {
        const binIndex = Math.min(Math.floor(length / binSize), numBins - 1);
        if (binIndex >= 0 && binIndex < bins.length) {
            bins[binIndex].yield += length;
        }
    }

    return bins;
}
