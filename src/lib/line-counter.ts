// Streaming utility for counting data lines in a BED file

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
