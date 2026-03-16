// External tool: seq_table
// Extracts per-read sequence table as TSV from a BAM file via @nanalogue/node.

import { seqTable } from "@nanalogue/node";
import {
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
} from "../monty-sandbox-helpers";

/**
 * Returns the seq_table tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxRecords - Maximum number of records to fetch from the BAM file.
 * @returns An async function callable from Python that returns the sequence table as TSV.
 */
export function makeSeqTable(
    allowedDir: string,
    maxRecords: number,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Extracts per-read sequence table as TSV from a BAM file.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns The sequence table as a TSV string.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        return seqTable(toReadOptions(resolved, opts, maxRecords));
    };
}
