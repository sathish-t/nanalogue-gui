// Pure validation and construction of QC configuration form snapshots.

import type { RegionParseResult } from "./region-parser";
import { parseRegion, validateModRegionOverlap } from "./region-parser";
import type { QCConfig } from "./types";

/** Primitive values read from the QC form and its custom elements. */
export interface QCConfigInputSnapshot {
    /** BAM file path or URL. */
    bamPath: string;
    /** Whether the BAM value is a URL. */
    treatAsUrl: boolean;
    /** Parsed modification tag. */
    tag: string;
    /** Parsed modification strand. */
    modStrand: "bc" | "bc_comp" | undefined;
    /** Raw sample fraction input. */
    sampleFraction: string;
    /** Raw sample seed input. */
    sampleSeed: string;
    /** Parsed window size. */
    windowSize: number;
    /** Raw read-length bin width. */
    readLengthBinWidth: string;
    /** Raw main region. */
    region: string;
    /** Raw modification sub-region. */
    modRegion: string;
    /** Whether reads must span the full region. */
    fullRegion: boolean;
    /** Known contigs used for region validation. */
    contigs: Record<string, number> | undefined;
    /** Optional minimum mapping quality. */
    mapqFilter: number | undefined;
    /** Whether unavailable mapping quality is excluded. */
    excludeMapqUnavail: boolean;
    /** Comma-separated selected alignment types. */
    readFilter: string | undefined;
    /** Optional minimum sequence length. */
    minSeqLen: number | undefined;
    /** Optional minimum alignment length. */
    minAlignLen: number | undefined;
    /** Raw read ID file path. */
    readIdFilePath: string;
    /** Optional modification base-quality threshold. */
    baseQualFilterMod: number | undefined;
    /** Optional number of read-end bases to trim. */
    trimReadEndsMod: number | undefined;
    /** Optional low modification probability bound. */
    modProbLow: number | undefined;
    /** Optional high modification probability bound. */
    modProbHigh: number | undefined;
}

/** Result of validating and building a QC configuration. */
export type QCConfigBuildResult =
    | {
          /** Successful result discriminator. */
          success: true;
          /** Canonical configuration. */
          config: QCConfig;
      }
    | {
          /** Failed result discriminator. */
          success: false;
          /** User-facing validation message. */
          message: string;
      };

/**
 * Validates a form snapshot and constructs the canonical QC configuration.
 *
 * @param input - Primitive snapshot already read from the form.
 * @returns A canonical config or the first user-facing validation failure.
 */
export function buildQCConfig(
    input: QCConfigInputSnapshot,
): QCConfigBuildResult {
    const sampleFraction = parseFloat(input.sampleFraction);
    if (
        Number.isNaN(sampleFraction) ||
        sampleFraction < 0.01 ||
        sampleFraction > 100
    ) {
        return {
            success: false,
            message: "Sample fraction must be a number between 0.01 and 100.",
        };
    }

    const sampleSeed = parseInt(input.sampleSeed, 10);
    if (Number.isNaN(sampleSeed) || sampleSeed < 0) {
        return {
            success: false,
            message: "Sample seed must be a non-negative integer.",
        };
    }

    if (
        !Number.isInteger(input.windowSize) ||
        input.windowSize < 2 ||
        input.windowSize > 10_000
    ) {
        return {
            success: false,
            message: "Window size must be an integer between 2 and 10,000.",
        };
    }

    const readLengthBinWidth = parseInt(input.readLengthBinWidth, 10);
    if (
        !Number.isFinite(readLengthBinWidth) ||
        readLengthBinWidth < 1 ||
        readLengthBinWidth !== Math.floor(readLengthBinWidth)
    ) {
        return {
            success: false,
            message: "Read length granularity must be a positive integer.",
        };
    }

    const regionInput = input.region.trim();
    let parsedRegion: RegionParseResult | undefined;
    if (regionInput && input.contigs) {
        parsedRegion = parseRegion(regionInput, input.contigs);
        if (!parsedRegion.valid) {
            return {
                success: false,
                message: `Invalid region: ${parsedRegion.reason}`,
            };
        }
    }

    const modRegionInput = input.modRegion.trim();
    if (modRegionInput) {
        if (!regionInput) {
            return {
                success: false,
                message: "Mod region requires a region to be set.",
            };
        }
        if (input.contigs) {
            const parsedModRegion = parseRegion(modRegionInput, input.contigs);
            if (!parsedModRegion.valid) {
                return {
                    success: false,
                    message: `Invalid mod region: ${parsedModRegion.reason}`,
                };
            }
            if (parsedRegion?.valid) {
                const overlapError = validateModRegionOverlap(
                    parsedRegion,
                    parsedModRegion,
                );
                if (overlapError)
                    return { success: false, message: overlapError };
            }
        }
    }

    const hasLow = input.modProbLow !== undefined;
    const hasHigh = input.modProbHigh !== undefined;
    if (hasLow !== hasHigh) {
        return {
            success: false,
            message:
                "Mod probability filter requires both low and high bounds.",
        };
    }
    if (
        input.modProbLow !== undefined &&
        input.modProbHigh !== undefined &&
        (!Number.isFinite(input.modProbLow) ||
            !Number.isFinite(input.modProbHigh) ||
            input.modProbLow >= input.modProbHigh)
    ) {
        return {
            success: false,
            message:
                "Mod probability filter: low bound must be less than high bound.",
        };
    }

    const region = regionInput || undefined;
    return {
        success: true,
        config: {
            bamPath: input.bamPath,
            treatAsUrl: input.treatAsUrl,
            tag: input.tag,
            modStrand: input.modStrand,
            region,
            modRegion: modRegionInput || undefined,
            fullRegion: region ? input.fullRegion : undefined,
            sampleFraction,
            sampleSeed,
            windowSize: input.windowSize,
            readLengthBinWidth,
            mapqFilter: input.mapqFilter,
            excludeMapqUnavail: input.excludeMapqUnavail || undefined,
            readFilter: input.readFilter,
            minSeqLen: input.minSeqLen,
            minAlignLen: input.minAlignLen,
            readIdFilePath: input.readIdFilePath.trim() || undefined,
            baseQualFilterMod: input.baseQualFilterMod,
            trimReadEndsMod: input.trimReadEndsMod,
            rejectModQualNonInclusive:
                input.modProbLow !== undefined &&
                input.modProbHigh !== undefined
                    ? [input.modProbLow, input.modProbHigh]
                    : undefined,
        },
    };
}
