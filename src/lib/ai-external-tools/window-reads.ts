// External tool: window_reads
// Computes windowed read statistics from a BAM file via @nanalogue/node.

import { windowReads } from "@nanalogue/node";
import {
    assertStringToolArgument,
    BAM_TOOL_KEYWORDS,
    enforceRecordLimit,
    rejectTreatAsUrl,
    resolvePath,
    SandboxError,
    toWindowOptions,
    WINDOW_OPTION_FIELDS,
} from "../monty-sandbox-helpers";
import type { SandboxToolSignature } from "../sandbox-tool-arguments";

export const /** Python parameters of window_reads(), matched to each call by bindSandboxToolCall. */ WINDOW_READS_SIGNATURE: SandboxToolSignature =
        {
            positional: ["bam_path"],
            required: 1,
            keywordOnly: [
                ...BAM_TOOL_KEYWORDS,
                ...Object.keys(WINDOW_OPTION_FIELDS),
            ],
        };

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
     * @returns The windowed statistics as an array.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        assertStringToolArgument(bamPath, "window_reads", "bam_path");
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const records = await windowReads(
            toWindowOptions(resolved, opts, maxRecords),
        );
        /* c8 ignore start -- defensive guard; @nanalogue/node always returns an array */
        if (!Array.isArray(records)) {
            throw new SandboxError(
                "RuntimeError",
                "window_reads returned a non-array result",
            );
        }
        /* c8 ignore stop */
        enforceRecordLimit(records, "window_reads", maxRecords);
        return records;
    };
}
