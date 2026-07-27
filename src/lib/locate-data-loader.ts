// Locate-reads data loader for parsing read ID files and generating BED output

import type { ReadInfoRecord } from "@nanalogue/node";
import { validateIpcRemoteBamUrl } from "./ipc-path-validation";

/** Named request used to generate a Locate BED file. */
export type LocateGenerateBedRequest = {
    /** BAM file path or URL. */
    bamPath: string;
    /** Path to the read ID text file. */
    readIdPath: string;
    /** Destination BED file path. */
    outputPath: string;
    /** Whether bamPath is a remote URL. */
    treatAsUrl: boolean;
} & (
    | {
          /** No genomic region constraint. */
          region?: undefined;
          /** Full-region filtering requires a region. */
          fullRegion?: undefined;
      }
    | {
          /** Genomic region constraint. */
          region: string;
          /** Whether reads must span the complete region. */
          fullRegion?: boolean;
      }
);

/**
 * Validates an untrusted Locate BED-generation IPC payload.
 *
 * @param value - The untrusted IPC payload.
 * @returns The validated Locate request.
 */
export function validateLocateGenerateBedRequest(
    value: unknown,
): LocateGenerateBedRequest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Invalid Locate request: expected an object");
    }
    const request = value as Record<string, unknown>;
    for (const field of ["bamPath", "readIdPath", "outputPath"] as const) {
        if (typeof request[field] !== "string" || request[field].length === 0) {
            throw new Error(
                `Invalid Locate request: ${field} must be a non-empty string`,
            );
        }
    }
    if (typeof request.treatAsUrl !== "boolean") {
        throw new Error("Invalid Locate request: treatAsUrl must be a boolean");
    }
    if (
        request.region !== undefined &&
        (typeof request.region !== "string" ||
            request.region.trim().length === 0)
    ) {
        throw new Error(
            "Invalid Locate request: region must be a non-empty string",
        );
    }
    if (
        request.fullRegion !== undefined &&
        typeof request.fullRegion !== "boolean"
    ) {
        throw new Error("Invalid Locate request: fullRegion must be a boolean");
    }
    if (request.fullRegion !== undefined && request.region === undefined) {
        throw new Error("Invalid Locate request: fullRegion requires region");
    }
    if (request.treatAsUrl) {
        validateIpcRemoteBamUrl(request.bamPath as string, "Locate");
    }
    const region = request.region as string | undefined;
    if (region !== undefined) {
        return {
            bamPath: request.bamPath as string,
            readIdPath: request.readIdPath as string,
            outputPath: request.outputPath as string,
            treatAsUrl: request.treatAsUrl as boolean,
            region,
            fullRegion: request.fullRegion as boolean | undefined,
        };
    }
    return {
        bamPath: request.bamPath as string,
        readIdPath: request.readIdPath as string,
        outputPath: request.outputPath as string,
        treatAsUrl: request.treatAsUrl as boolean,
    };
}

/** Result of parsing read IDs, including whether the ID cap was hit. */
export interface ParseReadIdsResult {
    /** The parsed read IDs (empty if capped). */
    ids: string[];
    /** The total number of unique read IDs found. */
    count: number;
    /** Whether the file contained more unique IDs than maxIds. */
    capped: boolean;
}

/**
 * Parses a plain-text string of read IDs, one per line.
 * Trims whitespace, filters out empty lines, and deduplicates.
 * Returns a capped result when unique IDs exceed maxIds.
 *
 * @param content - The raw file content to parse.
 * @param maxIds - The maximum number of unique IDs allowed (default 200,000).
 * @returns A result object with the parsed IDs, count, and cap status.
 */
export function parseReadIds(
    content: string,
    maxIds = 200_000,
): ParseReadIdsResult {
    const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const unique = [...new Set(lines)];

    if (unique.length > maxIds) {
        return { ids: [], count: unique.length, capped: true };
    }

    return { ids: unique, count: unique.length, capped: false };
}

/**
 * Summary of a locate-reads BED generation run.
 */
export interface LocateResult {
    /** Total number of IDs in the read ID file. */
    totalIds: number;
    /** Number of IDs that matched records in the BAM. */
    found: number;
    /** Number of matched records that were unmapped. */
    unmapped: number;
    /** Number of BED entries written (found minus unmapped). */
    bedEntries: number;
    /** Number of IDs not found in the BAM. */
    notFound: number;
}

/**
 * Result of generating BED lines from read info records.
 */
export interface GenerateBedResult {
    /** The BED-format lines ready to write to a file. */
    lines: string[];
    /** Summary counts of the generation run. */
    summary: LocateResult;
}

/**
 * Converts readInfo records into BED-format lines and computes summary counts.
 *
 * @param records - The read info records returned by readInfo.
 * @param totalIds - The total number of read IDs that were queried.
 * @returns An object with BED lines and a summary of counts.
 */
export function generateBedLines(
    records: ReadInfoRecord[],
    totalIds: number,
): GenerateBedResult {
    const lines: string[] = [];
    let unmapped = 0;

    for (const record of records) {
        if (record.alignment_type === "unmapped") {
            unmapped++;
            continue;
        }
        const strand = record.alignment_type.includes("forward") ? "+" : "-";
        lines.push(
            `${record.contig}\t${record.reference_start}\t${record.reference_end}\t${record.read_id}\t1000\t${strand}`,
        );
    }

    const foundIds = new Set(records.map((r) => r.read_id));
    const found = foundIds.size;
    return {
        lines,
        summary: {
            totalIds,
            found,
            unmapped,
            bedEntries: lines.length,
            notFound: totalIds - found,
        },
    };
}
