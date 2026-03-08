// External tool: window_reads
// Computes windowed read statistics from a BAM file via @nanalogue/node.

import { windowReads } from "@nanalogue/node";
import {
    enforceRecordLimit,
    rejectTreatAsUrl,
    resolvePath,
    SandboxError,
    toWindowOptions,
} from "../monty-sandbox-helpers";

/**
 * Returns the window_reads tool implementation bound to the given context.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @param maxRecords - Maximum number of windowed records to return.
 * @returns An async function callable from Python that returns windowed statistics.
 */
export function makeWindowReads(
    allowedDir: string,
    maxRecords: number,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Computes windowed read statistics from a BAM file.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns The windowed statistics as a parsed JSON array.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const json = await windowReads(
            toWindowOptions(resolved, opts, maxRecords),
        );
        const parsed: unknown = JSON.parse(json);
        /* c8 ignore start -- defensive guard; @nanalogue/node always returns an array */
        if (!Array.isArray(parsed)) {
            throw new SandboxError(
                "RuntimeError",
                "window_reads returned non-array JSON",
            );
        }
        /* c8 ignore stop */
        const records = parsed as unknown[];
        enforceRecordLimit(records, "window_reads", maxRecords);
        return records;
    };
}
