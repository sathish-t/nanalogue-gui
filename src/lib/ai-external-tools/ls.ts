// External tool: ls
// Lists files in the sandboxed directory, with optional glob filtering.

import { realpath } from "node:fs/promises";
import picomatch from "picomatch";
import { MAX_LS_ENTRIES } from "../ai-chat-constants";
import { isDeniedPath, listFilesRecursive } from "../monty-sandbox-helpers";

/**
 * Returns the ls tool implementation bound to the given allowed directory.
 *
 * @param allowedDir - The sandboxed root directory to list files within.
 * @returns An async function callable from Python that returns file paths.
 */
export function makeLs(
    allowedDir: string,
): (pattern?: string | Record<string, unknown>) => Promise<unknown> {
    /**
     * Lists files in the allowed directory, with optional glob filtering.
     *
     * Resolves allowedDir to its real path before listing so that relative()
     * always yields a clean subpath even when allowedDir itself contains symlinks.
     *
     * @param pattern - Optional glob pattern string, or options object (pattern ignored).
     * @returns An array of relative file paths, or an object with a _truncated key if capped.
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
            { pattern: matcher, deny: isDeniedPath },
        );
        if (capped) {
            return {
                files,
                _truncated: {
                    message:
                        `Listing capped at ${MAX_LS_ENTRIES} entries. ` +
                        "Use a glob pattern to narrow results (e.g. ls('**/*.bam')).",
                    cap: MAX_LS_ENTRIES,
                },
            };
        }
        return files;
    };
}
