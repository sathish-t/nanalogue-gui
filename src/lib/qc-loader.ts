// QC data loader using nanalogue-node

import { bamMods, peek, readInfo, windowReads } from "@nanalogue/node";
import { RunningHistogram } from "./histogram";
import type { PeekResult, QCConfig, QCData } from "./types";

/**
 * Maps a read length bin width to the maximum read length the histogram covers.
 *
 * @param binWidth - The read length bin width in base pairs.
 * @returns The maximum representable read length in base pairs.
 */
function maxReadLengthForBinWidth(binWidth: number): number {
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
    };
}

/**
 * Generates comprehensive QC data including read lengths, modification densities, and histograms.
 *
 * Uses streaming histograms to bin values on the fly, avoiding retention of
 * large raw arrays in memory.
 *
 * @param config - The QC configuration specifying the BAM file, sampling, region, and modification parameters.
 * @returns A promise that resolves to the full QC dataset with statistics and histograms.
 */
export async function generateQCData(config: QCConfig): Promise<QCData> {
    const baseOptions = {
        bamPath: config.bamPath,
        treatAsUrl: config.treatAsUrl,
        sampleFraction: config.sampleFraction / 100, // Convert percentage to fraction
        region: config.region,
        tag: config.tag,
        modStrand: config.modStrand,
    };

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

    // Get read info for length statistics
    console.log("Loading read info...");
    const reads = await readInfo(baseOptions);

    let droppedLengths = 0;
    for (const r of reads) {
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

    if (droppedLengths > 0) {
        console.warn(
            `Dropped ${droppedLengths} reads with non-finite alignment_length`,
        );
    }

    console.log(`  Got ${readLengthHist.count} reads`);

    if (readLengthHist.exceededCount > 0) {
        console.warn(
            `${readLengthHist.exceededCount} reads exceeded the maximum histogram range (${readLengthMax} bp)`,
        );
    }

    // Get modification data
    console.log("Loading modification data...");
    const modRecords = await bamMods(baseOptions);

    let loggedMissingModTable = false;
    let readsWithMods = 0;

    for (const record of modRecords) {
        if (record.alignment_type === "unmapped") continue;

        if (!record.mod_table) {
            if (!loggedMissingModTable) {
                console.warn("Some records lack modification data, skipping");
                loggedMissingModTable = true;
            }
            continue;
        }

        let probSum = 0;
        let probCount = 0;

        for (const entry of record.mod_table) {
            for (const [, , prob] of entry.data) {
                // Normalize raw 0-255 probabilities to 0-1 scale, clamping 255 into [0.99, 1.00]
                const normalizedProb = Math.min(prob / 255, 1 - Number.EPSILON);
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

    console.log(`  Got ${readsWithMods} reads with modifications`);
    console.log(`  Got ${rawProbabilityHist.count} modification calls`);

    // Get windowed densities
    console.log("Loading windowed densities...");
    const windowedTsv = await windowReads({
        ...baseOptions,
        win: config.windowSize,
        step: config.windowSize,
    });

    const windowedDensities = parseWindowedDensities(windowedTsv);
    for (const density of windowedDensities) {
        windowedDensityHist.add(Math.min(density, 1 - Number.EPSILON));
    }
    console.log(`  Got ${windowedDensityHist.count} windows`);

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
