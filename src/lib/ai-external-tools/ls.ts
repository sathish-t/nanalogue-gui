// External tool: ls
// Lists files in the sandboxed directory, with optional glob filtering.

import { realpath } from "node:fs/promises";
import picomatch from "picomatch";
import { MAX_LS_ENTRIES } from "../ai-chat-constants";
import {
    isDeniedPath,
    listFilesRecursive,
    SandboxError,
} from "../monty-sandbox-helpers";

/**
 * Returns the ls tool implementation bound to the given allowed directory.
 *
 * @param allowedDir - The sandboxed root directory to list files within.
 * @param maxEntries - Maximum number of entries to return before throwing.
 * @returns An async function callable from Python that returns file paths.
 */
export function makeLs(
    allowedDir: string,
    maxEntries = MAX_LS_ENTRIES,
): (pattern?: string | Record<string, unknown>) => Promise<unknown> {
    /**
     * Lists files in the allowed directory, with optional glob filtering.
     *
     * Resolves allowedDir to its real path before listing so that relative()
     * always yields a clean subpath even when allowedDir itself contains symlinks.
     * Always returns a plain list; throws if the cap is hit so Python never
     * silently receives a partial listing.
     *
     * @param pattern - Optional glob pattern string, or options object (pattern ignored).
     * @returns An array of relative file paths.
     */
    return async (
        pattern?: string | Record<string, unknown>,
    ): Promise<unknown> => {
        const patternStr = typeof pattern === "string" ? pattern : undefined;
        const matcher = patternStr ? picomatch(patternStr) : undefined;
        const allowedDirReal = await realpath(allowedDir);
        const { files, capped } = await listFilesRecursive(
            allowedDirReal,
            allowedDirReal,
            { pattern: matcher, deny: isDeniedPath, maxEntries },
        );
        if (capped) {
            throw new SandboxError(
                "ValueError",
                `ls() listing capped at ${maxEntries} entries. ` +
                    "Use a glob pattern to narrow results (e.g. ls('**/*.bam')).",
            );
        }
        return files;
    };
}
