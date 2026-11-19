// External tool: read_info
// Reads per-read alignment info from a BAM file via @nanalogue/node.

import { readInfo } from "@nanalogue/node";
import {
    assertStringToolArgument,
    BAM_TOOL_KEYWORDS,
    enforceRecordLimit,
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
} from "../monty-sandbox-helpers";
import type { SandboxToolSignature } from "../sandbox-tool-arguments";

export const /** Python parameters of read_info(), matched to each call by bindSandboxToolCall. */ READ_INFO_SIGNATURE: SandboxToolSignature =
        {
            positional: ["bam_path"],
            required: 1,
            keywordOnly: BAM_TOOL_KEYWORDS,
        };

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
        assertStringToolArgument(bamPath, "read_info", "bam_path");
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        const result = await readInfo(
            toReadOptions(resolved, opts, maxRecords),
        );
        enforceRecordLimit(result, "read_info", maxRecords);
        return result;
    };
}
