// External tool: window_reads
// Computes windowed read statistics from a BAM file via @nanalogue/node.

import { windowReads } from "@nanalogue/node";
import {
    assertStringToolArgument,
    BAM_TOOL_KEYWORDS,
    enforceRecordLimit,
    pythonTypeName,
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

/** Largest win or step the native addon accepts; it reads both as a Rust i32. */
const I32_MAX = 2_147_483_647;

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
        // win and step have no default; without these checks a missing,
        // non-integer, or out-of-range value fails in the native addon with
        // "Missing field `win`" or "Failed to convert napi value String into
        // rust type `i32`", and a whole number past the i32 range wraps.
        const missing = ["win", "step"].filter(
            (name) => opts?.[name] === undefined,
        );
        if (missing.length > 0) {
            throw new SandboxError(
                "TypeError",
                `window_reads() missing ${missing.length} required keyword-only ` +
                    `argument${missing.length === 1 ? "" : "s"}: ` +
                    missing.map((name) => `'${name}'`).join(" and "),
            );
        }
        for (const name of ["win", "step"]) {
            const value = opts?.[name];
            // A Python int beyond 2**53 arrives as a bigint, which is an int
            // but always out of range.
            if (typeof value !== "bigint" && !Number.isInteger(value)) {
                throw new SandboxError(
                    "TypeError",
                    `window_reads: ${name} must be an int, got ${pythonTypeName(value)}`,
                );
            }
            if (
                typeof value === "bigint" ||
                (value as number) < 1 ||
                (value as number) > I32_MAX
            ) {
                throw new SandboxError(
                    "ValueError",
                    `window_reads: ${name} must be between 1 and ${I32_MAX}, got ${value}`,
                );
            }
        }
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
