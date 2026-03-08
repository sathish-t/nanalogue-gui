// External tool: bam_mods
// Reads base modification data from a BAM file via @nanalogue/node.

import { bamMods } from "@nanalogue/node";
import {
    enforceRecordLimit,
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
} from "../monty-sandbox-helpers";

/**
 * Returns the bam_mods tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxRecords - Maximum number of records to return.
 * @returns An async function callable from Python that returns base modification records.
 */
export function makeBamMods(
    allowedDir: string,
    maxRecords: number,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Reads base modification data from a BAM file.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns An array of base modification records.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const result = await bamMods(toReadOptions(resolved, opts, maxRecords));
        enforceRecordLimit(result, "bam_mods", maxRecords);
        return result;
    };
}
