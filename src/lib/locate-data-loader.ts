// Locate-reads data loader for parsing read ID files and generating BED output

import type { ReadInfoRecord } from "@nanalogue/node";

/**
 * Parses a plain-text string of read IDs, one per line.
 * Trims whitespace and filters out empty lines.
 *
 * @param content - The raw file content to parse.
 * @returns An array of trimmed, non-empty read ID strings.
 */
export function parseReadIds(content: string): string[] {
    const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    return [...new Set(lines)];
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
