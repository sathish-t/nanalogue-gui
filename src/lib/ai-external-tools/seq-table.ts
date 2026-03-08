// External tool: seq_table
// Extracts per-read sequence table as TSV from a BAM file via @nanalogue/node.

import { seqTable } from "@nanalogue/node";
import {
    enforceDataSizeLimit,
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
} from "../monty-sandbox-helpers";

/**
 * Returns the seq_table tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxRecords - Maximum number of records to fetch from the BAM file.
 * @param maxOutputBytes - Maximum bytes allowed in the returned TSV string.
 * @returns An async function callable from Python that returns the sequence table as TSV.
 */
export function makeSeqTable(
    allowedDir: string,
    maxRecords: number,
    maxOutputBytes: number,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Extracts per-read sequence table as TSV from a BAM file.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns The sequence table as a TSV string, truncated to maxOutputBytes.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const tsv = await seqTable(toReadOptions(resolved, opts, maxRecords));
        return enforceDataSizeLimit(tsv, "seq_table", maxOutputBytes);
    };
}
