// Shared sandbox CLI argument definitions, numeric arg parser, and sandbox
// option builder. Imported by both nanalogue-chat (cli.ts) and
// nanalogue-sandbox-exec (execute-cli.ts) so sandbox flags are defined once.

import { CONFIG_FIELD_SPECS } from "./ai-chat-shared-constants";
import type { SandboxOptions } from "./chat-types";

export const /** Sandbox-related argument definitions for node:util parseArgs. Spread into each binary's own argConfig.options to include sandbox flags. */ SANDBOX_ARG_DEFS =
        {
            dir: { type: "string" as const },
            "max-records-read-info": { type: "string" as const },
            "max-records-bam-mods": { type: "string" as const },
            "max-records-window-reads": { type: "string" as const },
            "max-records-seq-table": { type: "string" as const },
            "max-duration-secs": { type: "string" as const },
            "max-memory-mb": { type: "string" as const },
            "max-allocations": { type: "string" as const },
            "max-read-mb": { type: "string" as const },
            "max-write-mb": { type: "string" as const },
        } as const;

/** Shape of the sandbox-related values returned by parseArgs when using SANDBOX_ARG_DEFS. */
export type SandboxArgValues = {
    [K in keyof typeof SANDBOX_ARG_DEFS]?: string;
};

/** Spec for a numeric CLI argument: allowed range and default fallback. */
interface NumericArgSpec {
    /** Minimum allowed value (inclusive). */
    min: number;
    /** Maximum allowed value (inclusive). */
    max: number;
    /** Default value when the flag is absent or non-numeric. */
    fallback: number;
}

/**
 * Parses and clamps a numeric CLI argument.
 * Returns the spec's fallback if the value is absent or non-finite.
 *
 * @param value - Raw string from parseArgs, or undefined if the flag was omitted.
 * @param spec - Allowed range and fallback for the field.
 * @returns The parsed and clamped integer.
 */
export function parseNumericArg(
    value: string | undefined,
    spec: NumericArgSpec,
): number {
    if (value === undefined) return spec.fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return spec.fallback;
    return Math.round(Math.max(spec.min, Math.min(spec.max, n)));
}

/**
 * Builds a SandboxOptions object from parsed CLI values and a pre-computed
 * maxOutputBytes limit. Used directly by nanalogue-sandbox-exec; nanalogue-chat
 * passes sandbox settings through AiChatConfig to the orchestrator instead.
 *
 * @param values - Parsed sandbox-related CLI values (from SANDBOX_ARG_DEFS).
 * @param maxOutputBytes - Pre-computed output byte ceiling.
 * @returns A SandboxOptions object ready for runSandboxCode.
 */
export function buildSandboxRunOptions(
    values: SandboxArgValues,
    maxOutputBytes: number,
): SandboxOptions {
    return {
        maxRecordsReadInfo: parseNumericArg(
            values["max-records-read-info"],
            CONFIG_FIELD_SPECS.maxRecordsReadInfo,
        ),
        maxRecordsBamMods: parseNumericArg(
            values["max-records-bam-mods"],
            CONFIG_FIELD_SPECS.maxRecordsBamMods,
        ),
        maxRecordsWindowReads: parseNumericArg(
            values["max-records-window-reads"],
            CONFIG_FIELD_SPECS.maxRecordsWindowReads,
        ),
        maxRecordsSeqTable: parseNumericArg(
            values["max-records-seq-table"],
            CONFIG_FIELD_SPECS.maxRecordsSeqTable,
        ),
        maxDurationSecs: parseNumericArg(
            values["max-duration-secs"],
            CONFIG_FIELD_SPECS.maxDurationSecs,
        ),
        maxMemory:
            parseNumericArg(
                values["max-memory-mb"],
                CONFIG_FIELD_SPECS.maxMemoryMB,
            ) *
            1024 *
            1024,
        maxAllocations: parseNumericArg(
            values["max-allocations"],
            CONFIG_FIELD_SPECS.maxAllocations,
        ),
        maxReadBytes:
            parseNumericArg(
                values["max-read-mb"],
                CONFIG_FIELD_SPECS.maxReadMB,
            ) *
            1024 *
            1024,
        maxWriteBytes:
            parseNumericArg(
                values["max-write-mb"],
                CONFIG_FIELD_SPECS.maxWriteMB,
            ) *
            1024 *
            1024,
        maxOutputBytes,
    };
}
