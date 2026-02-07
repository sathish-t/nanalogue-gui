// Pure formatting and trimming utilities shared across renderer pages.

import type { HistogramBin, YieldBin } from "./stats";

/**
 * Trims leading and trailing zero-count bins from a histogram bin array.
 *
 * @param bins - The histogram bins to trim.
 * @returns A new array with leading and trailing zero-count bins removed.
 */
export function trimZeroHistogramBins(bins: HistogramBin[]): HistogramBin[] {
    if (bins.length === 0) return bins;
    let start = 0;
    while (start < bins.length && bins[start].count === 0) start++;
    let end = bins.length - 1;
    while (end > start && bins[end].count === 0) end--;
    return bins.slice(start, end + 1);
}

/**
 * Trims leading and trailing zero-yield bins from a yield bin array.
 *
 * @param bins - The yield bins to trim.
 * @returns A new array with leading and trailing zero-yield bins removed.
 */
export function trimZeroYieldBins(bins: YieldBin[]): YieldBin[] {
    if (bins.length === 0) return bins;
    let start = 0;
    while (start < bins.length && bins[start].yield === 0) start++;
    let end = bins.length - 1;
    while (end > start && bins[end].yield === 0) end--;
    return bins.slice(start, end + 1);
}

/**
 * Formats a number into a human-readable string with optional SI suffixes.
 *
 * Numbers at or above one million are displayed with an "M" suffix, numbers at
 * or above one thousand with a "K" suffix, and smaller numbers are shown with
 * the specified number of decimal places.
 *
 * @param n - The number to format.
 * @param decimals - The number of decimal places to include.
 * @returns The formatted string representation of the number.
 */
export function formatNumber(n: number, decimals = 2): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(decimals)}M`;
    }
    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(decimals)}K`;
    }
    return n.toFixed(decimals);
}

/**
 * Formats a contig length into a human-readable string with SI suffixes.
 *
 * @param length - The contig length in base pairs.
 * @returns The formatted length string.
 */
export function formatContigLength(length: number): string {
    if (length >= 1_000_000) {
        return `${(length / 1_000_000).toFixed(2)} Mb`;
    }
    if (length >= 1_000) {
        return `${(length / 1_000).toFixed(1)} kb`;
    }
    return `${length} bp`;
}

/**
 * Formats a yield chart bin label adaptively based on the read length bin width.
 *
 * @param binStart - The start value of the bin.
 * @param binWidth - The bin width used for the read length histogram.
 * @returns The formatted label string.
 */
export function formatYieldLabel(binStart: number, binWidth: number): string {
    if (binWidth >= 1000) {
        return formatNumber(binStart, 0);
    }
    if (binWidth >= 100) {
        if (binStart >= 1_000_000) {
            return `${(binStart / 1_000_000).toFixed(1)}M`;
        }
        if (binStart >= 1_000) {
            return `${(binStart / 1_000).toFixed(1)}K`;
        }
        return binStart.toString();
    }
    // binWidth <= 10: raw numbers with thousand separators
    return binStart.toLocaleString();
}
