// Streaming utilities for counting lines in text and BED files

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { isBedHeaderLine } from "./bed-parser";

/**
 * Counts the number of data lines in a BED file using streaming.
 * Skips empty lines, comment lines (#), and BED header lines (track, browser).
 *
 * @param filePath - The path to the BED file to count lines in.
 * @returns A promise resolving to the number of data lines.
 */
export async function countBedDataLines(filePath: string): Promise<number> {
    const rl = createInterface({
        input: createReadStream(filePath, "utf-8"),
        crlfDelay: Number.POSITIVE_INFINITY,
    });

    let count = 0;
    for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || isBedHeaderLine(trimmed)) {
            continue;
        }
        count++;
    }
    return count;
}

/**
 * Counts the number of non-empty lines in a text file using streaming.
 * Skips lines that are empty or contain only whitespace.
 *
 * @param filePath - The path to the file to count lines in.
 * @returns A promise resolving to the number of non-empty lines.
 */
export async function countNonEmptyLines(filePath: string): Promise<number> {
    const rl = createInterface({
        input: createReadStream(filePath, "utf-8"),
        crlfDelay: Number.POSITIVE_INFINITY,
    });

    let count = 0;
    for await (const line of rl) {
        if (line.trim().length > 0) {
            count++;
        }
    }
    return count;
}
