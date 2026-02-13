// QC data loader: paginated BAM data retrieval with streaming histograms

import type { ReadOptions, WindowOptions } from "@nanalogue/node";
import { bamMods, peek, readInfo, windowReads } from "@nanalogue/node";
import { RunningHistogram } from "./histogram";
import type { PeekResult, QCConfig, QCData } from "./types";

/** Number of reads to fetch per pagination page. */
const PAGE_SIZE = 10_000;

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
 */
async function paginateReadInfo(
    baseOptions: ReadOptions,
    sampleSeed: number,
    readLengthHist: RunningHistogram,
    onProgress?: (
        source: "reads" | "modifications" | "windows",
        count: number,
    ) => void,
): Promise<void> {
    let offset = 0;
    let totalReads = 0;
    let droppedLengths = 0;

    // Fetch pages of reads until fewer than PAGE_SIZE records are returned
    for (;;) {
        const page = await readInfo({
            ...baseOptions,
            sampleSeed,
            limit: PAGE_SIZE,
            offset,
        });

        for (const r of page) {
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
        offset += page.length;
        onProgress?.("reads", totalReads);

        if (page.length < PAGE_SIZE) break;
    }

    if (droppedLengths > 0) {
        console.warn(
            `Dropped ${droppedLengths} reads with non-finite alignment_length`,
        );
    }

    console.log(`  Got ${readLengthHist.count} reads`);
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
        source: "reads" | "modifications" | "windows",
        count: number,
    ) => void,
): Promise<void> {
    let offset = 0;
    let totalRecords = 0;
    let loggedMissingModTable = false;
    let readsWithMods = 0;

    // Fetch pages of modification records until fewer than PAGE_SIZE are returned
    for (;;) {
        const page = await bamMods({
            ...baseOptions,
            sampleSeed,
            limit: PAGE_SIZE,
            offset,
        });

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
        offset += page.length;
        onProgress?.("modifications", totalRecords);

        if (page.length < PAGE_SIZE) break;
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
        source: "reads" | "modifications" | "windows",
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

    // Fetch pages of windowed TSV until fewer unique reads than PAGE_SIZE are found
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

        // Count unique read IDs in column 4 (index 3) to determine page completeness
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

        if (uniqueReadIds.size < PAGE_SIZE) break;
    }

    console.log(`  Got ${windowedDensityHist.count} windows`);
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
        source: "reads" | "modifications" | "windows",
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

    await Promise.all([
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
