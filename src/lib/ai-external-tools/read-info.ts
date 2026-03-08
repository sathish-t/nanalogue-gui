// External tool: read_info
// Reads per-read alignment info from a BAM file via @nanalogue/node.

import { readInfo } from "@nanalogue/node";
import {
    enforceRecordLimit,
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
} from "../monty-sandbox-helpers";

/**
 * Returns the read_info tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxRecords - Maximum number of records to return.
 * @returns An async function callable from Python that returns per-read alignment records.
 */
export function makeReadInfo(
    allowedDir: string,
    maxRecords: number,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Reads per-read alignment info from a BAM file.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns An array of per-read alignment records.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const result = await readInfo(
            toReadOptions(resolved, opts, maxRecords),
        );
        enforceRecordLimit(result, "read_info", maxRecords);
        return result;
    };
}
