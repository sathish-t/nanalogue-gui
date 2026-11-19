// External tool: peek
// Peeks at BAM file headers and summary metadata via @nanalogue/node.

import { peek as peekFn } from "@nanalogue/node";
import {
    assertStringToolArgument,
    rejectTreatAsUrl,
    resolvePath,
} from "../monty-sandbox-helpers";
import type { SandboxToolSignature } from "../sandbox-tool-arguments";

export const /** Python parameters of peek(), matched to each call by bindSandboxToolCall. */ PEEK_SIGNATURE: SandboxToolSignature =
        {
            positional: ["bam_path"],
            required: 1,
            keywordOnly: ["treat_as_url"],
        };

/**
 * Returns the peek tool implementation bound to the given allowed directory.
 *
 * @param allowedDir - The sandboxed root directory for path resolution.
 * @returns An async function callable from Python that returns BAM file metadata.
 */
export function makePeek(
    allowedDir: string,
): (bamPath: string, opts?: Record<string, unknown>) => Promise<unknown> {
    /**
     * Peeks at BAM file headers and summary info.
     *
     * @param bamPath - Path to the BAM file (relative or absolute within allowedDir).
     * @param opts - Optional snake_case options forwarded from Python.
     * @returns The BAM file metadata including contigs and modifications.
     */
    return async (
        bamPath: string,
        opts?: Record<string, unknown>,
    ): Promise<unknown> => {
        assertStringToolArgument(bamPath, "peek", "bam_path");
        rejectTreatAsUrl(opts);
        const resolved = await resolvePath(allowedDir, bamPath);
        return peekFn({ bamPath: resolved });
    };
}
