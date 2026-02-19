// QC data loader: paginated BAM data retrieval with streaming histograms

import type { ReadOptions, WindowOptions } from "@nanalogue/node";
import {
    bamMods,
    peek,
    readInfo,
    seqTable,
    windowReads,
} from "@nanalogue/node";
import { RunningHistogram } from "./histogram";
import type {
    PeekResult,
    QCConfig,
    QCData,
    ReadTypeCounts,
    SeqTableRow,
} from "./types";

/** Number of reads to fetch per pagination page. */
const PAGE_SIZE = 10_000;

/** Smaller page size for bamMods to limit peak memory from large mod tables. */
const MODS_PAGE_SIZE = 1_000;

/**
 * Maps a read length bin width to the maximum read length the histogram covers.
 *
 * @param binWidth - The read length bin width in base pairs.
 * @returns The maximum representable read length in base pairs.
 */
export function maxReadLengthForBinWidth(binWidth: number): number {
    if (binWidth >= 10_000) return 30_000_000;
    if (binWidth >= 1000) return 3_000_000;
    if (binWidth >= 10) return 300_000;
    return 30_000;
}

/**
 * Peeks at a BAM file to retrieve contig names and available modification types.
 *
 * @param bamPath - The filesystem path or URL to the BAM file.
 * @param treatAsUrl - Whether to treat the bamPath as a remote URL rather than a local file.
 * @returns A promise that resolves to a summary of contigs and modifications found in the BAM file.
 */
export async function peekBam(
    bamPath: string,
    treatAsUrl: boolean,
): Promise<PeekResult> {
    const result = await peek({ bamPath, treatAsUrl });

    const contigNames = Object.keys(result.contigs);
    const exampleContigs = contigNames.slice(0, 3);

    // Format modifications as +tag or -tag
    const modifications = result.modifications.map(([, strand, code]) => {
        const sign = strand === "+" ? "+" : "-";
        return `${sign}${code}`;
    });

    return {
        contigs: exampleContigs,
        totalContigs: contigNames.length,
        modifications: [...new Set(modifications)],
        allContigs: result.contigs,
    };
}

/**
 * Paginates through readInfo pages, accumulating alignment lengths into a histogram.
 *
 * Skips unmapped reads and warns about non-finite alignment lengths.
 * Reports progress after each page via the optional callback.
 *
 * @param baseOptions - The shared read options (BAM path, filters, sampling).
 * @param sampleSeed - The random seed for deterministic subsampling across pages.
 * @param readLengthHist - The histogram accumulator for read alignment lengths.
 * @param onProgress - Optional callback to report the running read count.
 * @returns The accumulated read type counts across all pages.
 */
async function paginateReadInfo(
    baseOptions: ReadOptions,
    sampleSeed: number,
    readLengthHist: RunningHistogram,
    onProgress?: (
        source: "reads" | "modifications" | "windows" | "sequences",
        count: number,
    ) => void,
): Promise<ReadTypeCounts> {
    let offset = 0;
    let totalReads = 0;
    let droppedLengths = 0;

    const counts: ReadTypeCounts = {
        primaryForward: 0,
        primaryReverse: 0,
        secondaryForward: 0,
        secondaryReverse: 0,
        supplementaryForward: 0,
        supplementaryReverse: 0,
        unmapped: 0,
    };

    /** Maps alignment_type strings to their ReadTypeCounts keys. */
    const typeToKey: Record<string, keyof ReadTypeCounts> = {
        primary_forward: "primaryForward",
        primary_reverse: "primaryReverse",
        secondary_forward: "secondaryForward",
        secondary_reverse: "secondaryReverse",
        supplementary_forward: "supplementaryForward",
        supplementary_reverse: "supplementaryReverse",
        unmapped: "unmapped",
    };

    // Fetch pages of reads until the API returns an empty page
    for (;;) {
        const page = await readInfo({
            ...baseOptions,
            sampleSeed,
            limit: PAGE_SIZE,
            offset,
        });

        if (page.length === 0) break;

        for (const r of page) {
            const key = typeToKey[r.alignment_type];
            if (key) {
                counts[key]++;
            }

            if (r.alignment_type === "unmapped") continue;
            const length = (
                r as {
                    /** The aligned length of the read in base pairs. */
                    alignment_length: number;
                }
            ).alignment_length;
            if (Number.isFinite(length)) {
                readLengthHist.add(length);
            } else {
                droppedLengths++;
            }
        }

        totalReads += page.length;
        offset += PAGE_SIZE;
        onProgress?.("reads", totalReads);
    }

    if (droppedLengths > 0) {
        console.warn(
            `Dropped ${droppedLengths} reads with non-finite alignment_length`,
        );
    }

    console.log(`  Got ${readLengthHist.count} reads`);
    return counts;
}

/**
 * Paginates through bamMods pages, accumulating probabilities and whole-read densities.
 *
 * Skips unmapped reads and records without modification tables.
 * Normalizes raw 0-255 probabilities to 0-1 scale.
 * Reports progress after each page via the optional callback.
 *
 * @param baseOptions - The shared read options (BAM path, filters, sampling).
 * @param sampleSeed - The random seed for deterministic subsampling across pages.
 * @param rawProbabilityHist - The histogram accumulator for individual modification probabilities.
 * @param wholeReadDensityHist - The histogram accumulator for per-read average modification density.
 * @param onProgress - Optional callback to report the running record count.
 */
async function paginateBamMods(
    baseOptions: ReadOptions,
    sampleSeed: number,
    rawProbabilityHist: RunningHistogram,
    wholeReadDensityHist: RunningHistogram,
    onProgress?: (
        source: "reads" | "modifications" | "windows" | "sequences",
        count: number,
    ) => void,
): Promise<void> {
    let offset = 0;
    let totalRecords = 0;
    let loggedMissingModTable = false;
    let readsWithMods = 0;

    // Fetch pages of modification records until the API returns an empty page
    for (;;) {
        const page = await bamMods({
            ...baseOptions,
            sampleSeed,
            limit: MODS_PAGE_SIZE,
            offset,
        });

        if (page.length === 0) break;

        for (const record of page) {
            if (record.alignment_type === "unmapped") continue;

            if (!record.mod_table) {
                if (!loggedMissingModTable) {
                    console.warn(
                        "Some records lack modification data, skipping",
                    );
                    loggedMissingModTable = true;
                }
                continue;
            }

            let probSum = 0;
            let probCount = 0;

            for (const entry of record.mod_table) {
                for (const [, , prob] of entry.data) {
                    // Normalize raw 0-255 probabilities to 0-1 scale, clamping 255 into [0.99, 1.00]
                    const normalizedProb = Math.min(
                        prob / 255,
                        1 - Number.EPSILON,
                    );
                    rawProbabilityHist.add(normalizedProb);
                    probSum += normalizedProb;
                    probCount++;
                }
            }

            if (probCount > 0) {
                wholeReadDensityHist.add(
                    Math.min(probSum / probCount, 1 - Number.EPSILON),
                );
                readsWithMods++;
            }
        }

        totalRecords += page.length;
        offset += MODS_PAGE_SIZE;
        onProgress?.("modifications", totalRecords);
    }

    console.log(`  Got ${readsWithMods} reads with modifications`);
    console.log(`  Got ${rawProbabilityHist.count} modification calls`);
}

/**
 * Paginates through windowReads pages, parsing TSV and accumulating densities.
 *
 * Each page returns a TSV string. Unique read IDs in column 4 are counted
 * to determine whether more pages remain.
 * Reports progress after each page via the optional callback.
 *
 * @param baseOptions - The shared read options (BAM path, filters, sampling).
 * @param sampleSeed - The random seed for deterministic subsampling across pages.
 * @param windowSize - The window and step size in base pairs.
 * @param windowedDensityHist - The histogram accumulator for windowed density values.
 * @param onProgress - Optional callback to report the running read count from windowed data.
 */
async function paginateWindowReads(
    baseOptions: ReadOptions,
    sampleSeed: number,
    windowSize: number,
    windowedDensityHist: RunningHistogram,
    onProgress?: (
        source: "reads" | "modifications" | "windows" | "sequences",
        count: number,
    ) => void,
): Promise<void> {
    // Build window options from the base read options, adding win/step
    const windowOptions: WindowOptions = {
        ...baseOptions,
        win: windowSize,
        step: windowSize,
    } as WindowOptions;

    let offset = 0;
    let totalReads = 0;

    // Fetch pages of windowed TSV until the API returns an empty page
    for (;;) {
        const tsv = await windowReads({
            ...windowOptions,
            sampleSeed,
            limit: PAGE_SIZE,
            offset,
        });

        const lines = tsv.trim().split("\n");

        // A page with only a header (or empty) means no more data
        if (lines.length < 2) break;

        // Parse densities and accumulate into histogram
        const densities = parseWindowedDensities(tsv);
        for (const density of densities) {
            windowedDensityHist.add(Math.min(density, 1 - Number.EPSILON));
        }

        // Count unique read IDs for progress reporting
        const uniqueReadIds = new Set<string>();
        for (let i = 1; i < lines.length; i++) {
            const fields = lines[i].split("\t");
            if (fields.length >= 4) {
                uniqueReadIds.add(fields[3]);
            }
        }

        totalReads += uniqueReadIds.size;
        offset += PAGE_SIZE;
        onProgress?.("windows", totalReads);
    }

    console.log(`  Got ${windowedDensityHist.count} windows`);
}

/** Maximum region size (in bp) for which sequence data is fetched. */
const SEQ_TABLE_MAX_REGION_BP = 500;

/**
 * Extracts the size in base pairs from a region string like "chr1:100-600".
 *
 * @param region - The region string, or undefined if no region is set.
 * @returns The region size in bp, or null if the region has no coordinate range.
 */
export function regionSizeBp(region: string | undefined): number | null {
    if (!region) return null;
    const match = /^.+:(\d+)-(\d+)$/.exec(region);
    if (!match) return null;
    return Number(match[2]) - Number(match[1]);
}

/**
 * Computes the average quality score in probability space, excluding 255 (missing).
 * Converts Q scores to error probabilities, averages them, then converts back.
 * Uses min-Q subtraction for numerical stability.
 *
 * @param qualities - Array of per-base quality scores.
 * @returns The probability-averaged quality (rounded), or null if no valid values.
 */
export function computeAvgQuality(qualities: number[]): number | null {
    let qMin = Number.POSITIVE_INFINITY;
    let count = 0;
    for (const q of qualities) {
        if (q !== 255) {
            if (q < qMin) qMin = q;
            count++;
        }
    }
    if (count === 0) return null;
    let sum = 0;
    for (const q of qualities) {
        if (q !== 255) {
            sum += 10 ** (-0.1 * (q - qMin));
        }
    }
    return qMin + Math.round(-10 * Math.log10(sum / count));
}

/**
 * Matches tagged sequences to base sequences by length.
 *
 * For each tagged sequence, finds the base sequence with the same length.
 * Returns null if any tagged length is ambiguous (duplicated) or unmatched.
 *
 * @param tagged - Array of tagged sequences for one readId.
 * @param base - Array of base sequences for the same readId.
 * @returns Array of base sequences in tagged order, or null if matching fails.
 */
export function matchBaseByLength(
    tagged: string[],
    base: string[],
): string[] | null {
    // Check tagged sequences have unique lengths
    const taggedLengths = tagged.map((s) => s.length);
    if (new Set(taggedLengths).size !== taggedLengths.length) return null;

    // Build base lookup by length, rejecting duplicate lengths
    const baseByLen = new Map<number, string>();
    for (const s of base) {
        if (baseByLen.has(s.length)) return null;
        baseByLen.set(s.length, s);
    }

    // Match each tagged sequence to its base counterpart
    const result: string[] = [];
    for (const s of tagged) {
        const match = baseByLen.get(s.length);
        if (match === undefined) return null;
        result.push(match);
    }

    return result;
}

/**
 * A partial sequence table row containing only the fields parsed directly from TSV.
 */
interface PartialSeqRow {
    /** The unique read identifier. */
    readId: string;
    /** The sequence string. */
    sequence: string;
    /** Per-base quality scores parsed from the period-delimited quality string. */
    qualities: number[];
}

/**
 * Result of fetching sequence table data, containing either rows or a skip reason.
 */
interface SeqTableResult {
    /** The parsed sequence table rows, present when data was fetched successfully. */
    rows?: SeqTableRow[];
    /** Human-readable reason why sequence data was skipped. */
    skipReason?: string;
}

/**
 * Parses a TSV string from seqTable into an array of partial row objects.
 *
 * Each row contains readId, sequence, and qualities. The baseSequence
 * and avgQuality fields are left to be filled by the caller.
 *
 * @param tsv - The raw TSV string output from seqTable.
 * @returns An array of objects with readId, sequence, and qualities fields.
 */
export function parseSeqTableTsv(tsv: string): PartialSeqRow[] {
    const trimmed = tsv.trimEnd();
    if (trimmed.length === 0) return [];

    const lines = trimmed.split("\n");
    if (lines.length < 2) return [];

    const rows: PartialSeqRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;

        const fields = line.split("\t");
        if (fields.length < 3) continue;

        const readId = fields[0];
        const sequence = fields[1];
        const rawQual = fields[2];
        const qualities =
            rawQual === ""
                ? []
                : rawQual.split(".").map(Number).filter(Number.isFinite);

        rows.push({ readId, sequence, qualities });
    }

    return rows;
}

/**
 * Fetches sequence table data by calling seqTable twice: once with the user's tag
 * and once with tag "1" (no modifications) to detect modified positions.
 *
 * Returns early with a skip reason if the region is not set or exceeds the size limit.
 *
 * @param config - The QC configuration.
 * @param sharedOptions - The shared read options built from config.
 * @param onProgress - Optional callback to report progress.
 * @returns An object with either rows or a skipReason.
 */
async function fetchSeqTable(
    config: QCConfig,
    sharedOptions: Record<string, unknown>,
    onProgress?: (
        source: "reads" | "modifications" | "windows" | "sequences",
        count: number,
    ) => void,
): Promise<SeqTableResult> {
    const size = regionSizeBp(config.region);

    if (size === null) {
        return { skipReason: "no region selected" };
    }

    if (size > SEQ_TABLE_MAX_REGION_BP) {
        return { skipReason: `region > ${SEQ_TABLE_MAX_REGION_BP} bp` };
    }

    // Build seqTable options: wire region, always set fullRegion to true,
    // and clear modRegion (seqTable uses region as modRegion internally).
    const seqOptions: ReadOptions = {
        ...sharedOptions,
        region: config.region,
        fullRegion: true,
        modRegion: undefined,
        sampleSeed: config.sampleSeed,
    } as ReadOptions;

    // Call seqTable twice in parallel: with user's tag, and with tag "1" (no mods)
    const [taggedTsv, baseTsv] = await Promise.all([
        seqTable(seqOptions),
        seqTable({
            ...seqOptions,
            tag: "1",
        } as ReadOptions),
    ]);

    const taggedRows = parseSeqTableTsv(taggedTsv);
    const baseRows = parseSeqTableTsv(baseTsv);

    // Build a lookup from the base (no-mod) results by readId
    const baseByReadId = new Map<string, string>();
    for (const row of baseRows) {
        baseByReadId.set(row.readId, row.sequence);
    }

    const result: SeqTableRow[] = [];
    for (const row of taggedRows) {
        const baseSequence = baseByReadId.get(row.readId) ?? row.sequence;
        result.push({
            readId: row.readId,
            sequence: row.sequence,
            baseSequence,
            qualities: row.qualities,
            avgQuality: computeAvgQuality(row.qualities),
        });
    }

    onProgress?.("sequences", result.length);

    return { rows: result };
}

/**
 * Generates comprehensive QC data including read lengths, modification densities, and histograms.
 *
 * Runs three concurrent pagination loops to fetch data in pages of PAGE_SIZE,
 * using streaming histograms to bin values on the fly and avoid retaining
 * large raw arrays in memory.
 *
 * @param config - The QC configuration specifying the BAM file, sampling, region, and modification parameters.
 * @param onProgress - Optional callback invoked with the data source name and running count as records are processed.
 * @returns A promise that resolves to the full QC dataset with statistics and histograms.
 */
export async function generateQCData(
    config: QCConfig,
    onProgress?: (
        source: "reads" | "modifications" | "windows" | "sequences",
        count: number,
    ) => void,
): Promise<QCData> {
    const sampleSeed = config.sampleSeed;

    const sharedOptions = {
        bamPath: config.bamPath,
        treatAsUrl: config.treatAsUrl,
        sampleFraction: config.sampleFraction / 100, // Convert percentage to fraction
        tag: config.tag,
        modStrand: config.modStrand,
        modRegion: config.modRegion,
        ...(config.mapqFilter !== undefined && {
            mapqFilter: config.mapqFilter,
        }),
        ...(config.excludeMapqUnavail !== undefined && {
            excludeMapqUnavail: config.excludeMapqUnavail,
        }),
        ...(config.readFilter !== undefined && {
            readFilter: config.readFilter,
        }),
        ...(config.minSeqLen !== undefined && { minSeqLen: config.minSeqLen }),
        ...(config.minAlignLen !== undefined && {
            minAlignLen: config.minAlignLen,
        }),
        ...(config.readIdSet !== undefined && { readIdSet: config.readIdSet }),
        ...(config.baseQualFilterMod !== undefined && {
            baseQualFilterMod: config.baseQualFilterMod,
        }),
        ...(config.trimReadEndsMod !== undefined && {
            trimReadEndsMod: config.trimReadEndsMod,
        }),
        ...(config.rejectModQualNonInclusive !== undefined && {
            rejectModQualNonInclusive: config.rejectModQualNonInclusive,
        }),
    };
    const baseOptions: ReadOptions = config.region
        ? {
              ...sharedOptions,
              region: config.region,
              fullRegion: config.fullRegion,
          }
        : sharedOptions;

    const readLengthBinWidth = config.readLengthBinWidth;
    const readLengthMax = maxReadLengthForBinWidth(readLengthBinWidth);

    // Streaming histograms — bin values on the fly instead of accumulating raw arrays
    const readLengthHist = new RunningHistogram(
        readLengthBinWidth,
        readLengthMax,
    );
    const wholeReadDensityHist = new RunningHistogram(0.01, 1.0);
    const rawProbabilityHist = new RunningHistogram(0.01, 1.0);
    const windowedDensityHist = new RunningHistogram(0.01, 1.0);

    // Load all three data sources in parallel via paginated loops
    console.log(
        "Loading read info, modification data, and windowed densities...",
    );

    const [readTypeCounts, , , seqResult] = await Promise.all([
        paginateReadInfo(baseOptions, sampleSeed, readLengthHist, onProgress),
        paginateBamMods(
            baseOptions,
            sampleSeed,
            rawProbabilityHist,
            wholeReadDensityHist,
            onProgress,
        ),
        paginateWindowReads(
            baseOptions,
            sampleSeed,
            config.windowSize,
            windowedDensityHist,
            onProgress,
        ),
        fetchSeqTable(config, sharedOptions, onProgress),
    ]);

    if (readLengthHist.exceededCount > 0) {
        console.warn(
            `${readLengthHist.exceededCount} reads exceeded the maximum histogram range (${readLengthMax} bp)`,
        );
    }

    // Extract statistics and histogram bins from streaming accumulators
    return {
        readLengthStats: readLengthHist.toStats(true),
        readLengthHistogram: readLengthHist.toBins(),
        yieldByLength: readLengthHist.toYieldBins(),
        readLengthBinWidth,
        exceededReadLengths: readLengthHist.exceededCount,

        wholeReadDensityStats: wholeReadDensityHist.toStats(false),
        wholeReadDensityHistogram: wholeReadDensityHist.toBins(),

        windowedDensityStats: windowedDensityHist.toStats(false),
        windowedDensityHistogram: windowedDensityHist.toBins(),

        rawProbabilityStats: rawProbabilityHist.toStats(false),
        rawProbabilityHistogram: rawProbabilityHist.toBins(),

        sampleSeed,
        readTypeCounts,
        seqTableRows: seqResult.rows,
        seqTableSkipReason: seqResult.skipReason,
    };
}

/**
 * Parses a TSV string of windowed read data and extracts the modification density values.
 *
 * @param tsv - The raw TSV string output from the windowReads command.
 * @returns An array of numeric modification density values from the windowed data.
 */
export function parseWindowedDensities(tsv: string): number[] {
    const lines = tsv.trim().split("\n");
    if (lines.length < 2) return [];

    const densities: number[] = [];
    let droppedCount = 0;

    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split("\t");
        if (fields.length >= 5) {
            const winVal = parseFloat(fields[4]);
            if (Number.isFinite(winVal)) {
                densities.push(winVal);
            } else {
                droppedCount++;
            }
        }
    }

    if (droppedCount > 0) {
        console.warn(
            `parseWindowedDensities: dropped ${droppedCount} rows with non-finite density values`,
        );
    }

    return densities;
}
