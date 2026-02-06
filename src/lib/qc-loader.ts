// QC data loader using nanalogue-node

import { bamMods, peek, readInfo, windowReads } from "@nanalogue/node";
import { binHistogram, binYield, calculateStats } from "./stats";
import type { PeekResult, QCConfig, QCData } from "./types";

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

    // Get read info for length statistics
    console.log("Loading read info...");
    const reads = await readInfo(baseOptions);

    const readLengths = reads
        .filter((r) => r.alignment_type !== "unmapped")
        .map(
            (r) =>
                (
                    r as {
                        /** The aligned length of the read in base pairs. */
                        alignment_length: number;
                    }
                ).alignment_length,
        );

    console.log(`  Got ${readLengths.length} reads`);

    // Get modification data
    console.log("Loading modification data...");
    const modRecords = await bamMods(baseOptions);

    // Calculate whole-read densities (mean probability per read)
    const wholeReadDensities: number[] = [];
    const allProbabilities: number[] = [];

    for (const record of modRecords) {
        if (record.alignment_type === "unmapped") continue;

        const probs: number[] = [];
        for (const entry of record.mod_table) {
            for (const [, , prob] of entry.data) {
                const normalizedProb = prob / 255;
                probs.push(normalizedProb);
                allProbabilities.push(normalizedProb);
            }
        }

        if (probs.length > 0) {
            const meanProb = probs.reduce((a, b) => a + b, 0) / probs.length;
            wholeReadDensities.push(meanProb);
        }
    }

    console.log(`  Got ${wholeReadDensities.length} reads with modifications`);
    console.log(`  Got ${allProbabilities.length} modification calls`);

    // Get windowed densities
    console.log("Loading windowed densities...");
    const windowedTsv = await windowReads({
        ...baseOptions,
        win: config.windowSize,
        step: config.windowSize,
    });

    const windowedDensities = parseWindowedDensities(windowedTsv);
    console.log(`  Got ${windowedDensities.length} windows`);

    // Calculate statistics and histograms
    const readLengthStats = calculateStats(readLengths, true);
    const readLengthHistogram = binHistogram(readLengths, 5000);
    const yieldByLength = binYield(readLengths, 5000);

    const wholeReadDensityStats = calculateStats(wholeReadDensities);
    const wholeReadDensityHistogram = binHistogram(
        wholeReadDensities,
        0.02,
        0,
        1,
    );

    const windowedDensityStats = calculateStats(windowedDensities);
    const windowedDensityHistogram = binHistogram(
        windowedDensities,
        0.02,
        0,
        1,
    );

    const rawProbabilityStats = calculateStats(allProbabilities);
    const rawProbabilityHistogram = binHistogram(allProbabilities, 0.02, 0, 1);

    return {
        readLengths,
        readLengthStats,
        readLengthHistogram,
        yieldByLength,

        wholeReadDensities,
        wholeReadDensityStats,
        wholeReadDensityHistogram,

        windowedDensities,
        windowedDensityStats,
        windowedDensityHistogram,

        rawProbabilities: allProbabilities,
        rawProbabilityStats,
        rawProbabilityHistogram,
    };
}

/**
 * Parses a TSV string of windowed read data and extracts the modification density values.
 *
 * @param tsv - The raw TSV string output from the windowReads command.
 * @returns An array of numeric modification density values from the windowed data.
 */
function parseWindowedDensities(tsv: string): number[] {
    const lines = tsv.trim().split("\n");
    if (lines.length < 2) return [];

    const densities: number[] = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split("\t");
        if (fields.length >= 5) {
            const winVal = parseFloat(fields[4]);
            if (!Number.isNaN(winVal)) {
                densities.push(winVal);
            }
        }
    }

    return densities;
}
