import type { HistogramBin, Stats, YieldBin } from "../../lib/stats";
import type { SeqTableRow } from "../../lib/types";

/**
 * Represents an active Chart.js chart instance.
 */
export interface ChartInstance {
    /** Destroys the chart instance and releases associated resources. */
    destroy(): void;
    /** Triggers a resize of the chart to fit its container. */
    resize(): void;
}

/**
 * Counts of reads by alignment type and strand direction.
 */
export interface ReadTypeCounts {
    /** Number of primary alignments on the forward strand. */
    primaryForward: number;
    /** Number of primary alignments on the reverse strand. */
    primaryReverse: number;
    /** Number of secondary alignments on the forward strand. */
    secondaryForward: number;
    /** Number of secondary alignments on the reverse strand. */
    secondaryReverse: number;
    /** Number of supplementary alignments on the forward strand. */
    supplementaryForward: number;
    /** Number of supplementary alignments on the reverse strand. */
    supplementaryReverse: number;
    /** Number of unmapped reads. */
    unmapped: number;
}

/**
 * Complete quality control data returned from the main process.
 */
export interface QCData {
    /** Summary statistics for read lengths. */
    readLengthStats: Stats;
    /** Histogram bins for the read length distribution. */
    readLengthHistogram: HistogramBin[];
    /** Yield bins bucketed by read length. */
    yieldByLength: YieldBin[];
    /** The bin width used for the read length histogram. */
    readLengthBinWidth: number;
    /** The number of reads that exceeded the histogram range. */
    exceededReadLengths: number;
    /** Summary statistics for whole-read analogue density. */
    wholeReadDensityStats: Stats;
    /** Histogram bins for the whole-read density distribution. */
    wholeReadDensityHistogram: HistogramBin[];
    /** Summary statistics for windowed analogue density. */
    windowedDensityStats: Stats;
    /** Histogram bins for the windowed density distribution. */
    windowedDensityHistogram: HistogramBin[];
    /** Summary statistics for raw modification probability. */
    rawProbabilityStats: Stats;
    /** Histogram bins for the raw probability distribution. */
    rawProbabilityHistogram: HistogramBin[];
    /** The random seed used for subsampling. */
    sampleSeed: number;
    /** Counts of reads by alignment type and strand direction. */
    readTypeCounts: ReadTypeCounts;
    /** Parsed sequence table rows, undefined when region > 500 bp or not set. */
    seqTableRows?: SeqTableRow[];
    /** Human-readable reason why sequence data was skipped. */
    seqTableSkipReason?: string;
    /** Read IDs excluded because multiple alignments had the same sequence length. */
    seqTableAmbiguousReadIds?: string[];
}

/**
 * API surface exposed to the QC results renderer via the preload bridge.
 */
export interface QCResultsApi {
    /** Fetches the full QC dataset from the main process. */
    getQCData: () => Promise<QCData>;
    /** Navigates the user back to the configuration page. */
    goBackToConfig: () => Promise<void>;
}
