// BED file parser for nanalogue-swipe

import { readFileSync } from "node:fs";
import type { BedAnnotation } from "./types";

/** Result of parsing a BED file, including whether the entry cap was hit. */
export interface ParseBedResult {
    /** The parsed annotations, capped at maxEntries. */
    annotations: BedAnnotation[];
    /** Whether the file contained more entries than maxEntries. */
    capped: boolean;
}

/**
 * Checks whether a line is a BED header or comment line.
 * Matches `#` comments and the `track`/`browser` keywords when followed by
 * whitespace or at end-of-line, so contigs like `track1` are not skipped.
 *
 * @param line - The trimmed line to check.
 * @returns True if the line is a header or comment.
 */
export function isBedHeaderLine(line: string): boolean {
    return (
        line.startsWith("#") ||
        line === "track" ||
        line.startsWith("track ") ||
        line.startsWith("track\t") ||
        line === "browser" ||
        line.startsWith("browser ") ||
        line.startsWith("browser\t")
    );
}

/**
 * Parses a BED file and returns annotations with contig, coordinates, and read ID.
 * When the file contains more than maxEntries valid lines, parsing stops early and
 * the result is flagged as capped.
 *
 * @param bedPath - The filesystem path to the BED file to parse.
 * @param maxEntries - Maximum number of annotations to return (default 10,000).
 * @returns The parsed annotations and whether the cap was reached.
 */
export function parseBedFile(
    bedPath: string,
    maxEntries = 10_000,
): ParseBedResult {
    const content = readFileSync(bedPath, "utf-8");
    const lines = content.trim().split("\n");
    const annotations: BedAnnotation[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || isBedHeaderLine(line)) {
            continue;
        }

        const fields = line.split("\t");

        if (fields.length < 4) {
            console.warn(
                `Skipping line ${i + 1}: insufficient columns (need at least 4, got ${fields.length})`,
            );
            continue;
        }

        const contig = fields[0];
        const start = parseInt(fields[1], 10);
        const end = parseInt(fields[2], 10);
        const readId = fields[3];

        if (Number.isNaN(start) || Number.isNaN(end)) {
            console.warn(
                `Skipping line ${i + 1}: invalid start/end coordinates`,
            );
            continue;
        }

        if (start < 0 || end < 0 || start >= end) {
            console.warn(
                `Skipping line ${i + 1}: coordinates must satisfy 0 <= start < end (got start=${start}, end=${end})`,
            );
            continue;
        }

        if (!readId) {
            console.warn(`Skipping line ${i + 1}: missing read_id in column 4`);
            continue;
        }

        annotations.push({
            contig,
            start,
            end,
            readId,
            rawLine: line,
        });

        if (annotations.length > maxEntries) {
            return {
                annotations: annotations.slice(0, maxEntries),
                capped: true,
            };
        }
    }

    return { annotations, capped: false };
}
