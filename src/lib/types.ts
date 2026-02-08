// Type definitions shared across nanalogue-gui modes

import type { HistogramBin, Stats, YieldBin } from "./stats";

/**
 * Represents a single annotation row parsed from a BED file.
 */
export interface BedAnnotation {
    /** The contig or chromosome name for this annotation. */
    contig: string;
    /** The zero-based start position of the annotated region. */
    start: number;
    /** The exclusive end position of the annotated region. */
    end: number;
    /** The unique identifier of the read associated with this annotation. */
    readId: string;
    /** The original unparsed line from the BED file. */
    rawLine: string;
}

/**
 * Represents a single x-y data point used in raw signal plots.
 */
export interface PlotDataPoint {
    /** The x-axis coordinate of the data point. */
    x: number;
    /** The y-axis coordinate of the data point. */
    y: number;
}

/**
 * Represents a single windowed aggregation point over a reference region.
 */
export interface WindowedPoint {
    /** The start position of the reference window. */
    refWinStart: number;
    /** The end position of the reference window. */
    refWinEnd: number;
    /** The aggregated value computed within this window. */
    winVal: number;
}

/**
 * Contains all data required to render a plot for a single annotation.
 */
export interface PlotData {
    /** The array of raw signal data points for the plot. */
    rawPoints: PlotDataPoint[];
    /** The array of windowed aggregation points for the plot. */
    windowedPoints: WindowedPoint[];
    /** The BED annotation that this plot corresponds to. */
    annotation: BedAnnotation;
    /** The genomic region expanded around the annotation for context. */
    expandedRegion: {
        /** The contig or chromosome name of the expanded region. */
        contig: string;
        /** The start position of the expanded region. */
        start: number;
        /** The end position of the expanded region. */
        end: number;
    };
    /** Warning message if annotation coordinates were clamped to contig bounds. */
    clampWarning?: string;
}

/**
 * Represents a single row of windowed read data from the analysis pipeline.
 */
export interface WindowReadRow {
    /** The contig or chromosome name for this row. */
    contig: string;
    /** The start position of the reference window for this row. */
    ref_win_start: number;
    /** The end position of the reference window for this row. */
    ref_win_end: number;
    /** The unique identifier of the read this row belongs to. */
    read_id: string;
    /** The aggregated modification value within this window. */
    win_val: number;
    /** The alignment strand of the read. */
    strand: string;
    /** The base at the modification site. */
    base: string;
    /** The strand on which the modification was called. */
    mod_strand: string;
    /** The type of base modification detected. */
    mod_type: string;
    /** The start position of the window in read coordinates. */
    win_start: number;
    /** The end position of the window in read coordinates. */
    win_end: number;
    /** The basecall quality score for this position. */
    basecall_qual: number;
}

/**
 * Tracks the current state of the swipe annotation review workflow.
 */
export interface AppState {
    /** The zero-based index of the annotation currently being reviewed. */
    currentIndex: number;
    /** The total number of annotations available for review. */
    totalCount: number;
    /** The number of annotations the user has accepted so far. */
    acceptedCount: number;
    /** The number of annotations the user has rejected so far. */
    rejectedCount: number;
    /** The file path where accepted annotations are being written. */
    outputPath?: string;
    /** Whether to show the annotation region highlight box on the chart. */
    showAnnotationHighlight?: boolean;
}

/**
 * Holds the command-line arguments provided when launching swipe mode.
 */
export interface CliArgs {
    /** The file path to the BAM alignment file. */
    bamPath: string;
    /** The file path to the BED annotation file. */
    bedPath: string;
    /** The file path where accepted annotations will be written. */
    outputPath: string;
    /** The size of the aggregation window in base pairs. */
    windowSize: number;
}

// QC Types

/**
 * Configuration parameters for a quality-control analysis run.
 */
export interface QCConfig {
    /** The file path or URL to the BAM alignment file. */
    bamPath: string;
    /** Whether the BAM path should be treated as a remote URL. */
    treatAsUrl: boolean;
    /** The optional BAM tag used to filter or group reads. */
    tag?: string;
    /** The strand convention for modification calls. */
    modStrand?: "bc" | "bc_comp";
    /** The optional genomic region to restrict the analysis to. */
    region?: string;
    /** Optional genomic sub-region to restrict modification filtering. */
    modRegion?: string;
    /** Whether to only include reads that fully span the specified region. Undefined when no region is set. */
    fullRegion: boolean | undefined;
    /** The fraction of reads to sample for the QC analysis. */
    sampleFraction: number;
    /** The size of the aggregation window in base pairs. */
    windowSize: number;
    /** The bin width for the read length histogram in base pairs. */
    readLengthBinWidth: number;
}

/**
 * Contains preliminary metadata obtained by peeking into a BAM file.
 */
export interface PeekResult {
    /** The list of contig names found in the BAM header. */
    contigs: string[];
    /** The total number of contigs present in the BAM header. */
    totalContigs: number;
    /** The list of modification types detected in the BAM file. */
    modifications: string[];
    /** Full contig-to-length mapping from the BAM header. */
    allContigs: Record<string, number>;
}

/**
 * Holds all computed quality-control metrics and distributions for a BAM file.
 */
export interface QCData {
    /** Summary statistics computed over the read length distribution. */
    readLengthStats: Stats;
    /** The histogram bins for the read length distribution. */
    readLengthHistogram: HistogramBin[];
    /** The cumulative yield bins sorted by read length. */
    yieldByLength: YieldBin[];
    /** The bin width used for the read length histogram. */
    readLengthBinWidth: number;
    /** The number of reads that exceeded the histogram's maximum representable length. */
    exceededReadLengths: number;

    /** Summary statistics computed over the whole-read density distribution. */
    wholeReadDensityStats: Stats;
    /** The histogram bins for the whole-read density distribution. */
    wholeReadDensityHistogram: HistogramBin[];

    /** Summary statistics computed over the windowed density distribution. */
    windowedDensityStats: Stats;
    /** The histogram bins for the windowed density distribution. */
    windowedDensityHistogram: HistogramBin[];

    /** Summary statistics computed over the raw probability distribution. */
    rawProbabilityStats: Stats;
    /** The histogram bins for the raw probability distribution. */
    rawProbabilityHistogram: HistogramBin[];
}
