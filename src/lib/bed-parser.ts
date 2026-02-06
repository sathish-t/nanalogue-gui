// BED file parser for nanalogue-swipe

import { readFileSync } from "node:fs";
import type { BedAnnotation } from "./types";

/**
 * Parses a BED file and returns an array of annotations with contig, coordinates, and read ID.
 *
 * @param bedPath - The filesystem path to the BED file to parse.
 * @returns An array of parsed BED annotations, skipping malformed or comment lines.
 */
export function parseBedFile(bedPath: string): BedAnnotation[] {
    const content = readFileSync(bedPath, "utf-8");
    const lines = content.trim().split("\n");
    const annotations: BedAnnotation[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || line.startsWith("#")) {
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
    }

    return annotations;
}
