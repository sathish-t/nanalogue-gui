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
    /** Default value when the flag is absent. */
    fallback: number;
}

/** Result of parseNumericArg: either a valid integer or a human-readable error. */
export type ParseNumericArgResult =
    | {
          /** Discriminant — always true on the success branch. */
          ok: true;
          /** The parsed and range-checked integer. */
          value: number;
      }
    | {
          /** Discriminant — always false on the error branch. */
          ok: false;
          /** Human-readable description of the validation failure, including the flag name. */
          error: string;
      };

/**
 * Parses a numeric CLI argument and validates it against allowed bounds.
 * Returns the spec's fallback when the flag is absent.
 * Returns an error result when the value is non-numeric or out of range.
 *
 * @param flagName - CLI flag name without leading dashes (e.g. "max-duration-secs"), used in error messages.
 * @param value - Raw string from parseArgs, or undefined if the flag was omitted.
 * @param spec - Allowed range and fallback for the field.
 * @returns Ok:true with the parsed integer, or ok:false with a human-readable error.
 */
export function parseNumericArg(
    flagName: string,
    value: string | undefined,
    spec: NumericArgSpec,
): ParseNumericArgResult {
    if (value === undefined) return { ok: true, value: spec.fallback };
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return {
            ok: false,
            error: `--${flagName}: "${value}" is not a valid number`,
        };
    }
    const rounded = Math.round(n);
    if (rounded < spec.min) {
        return {
            ok: false,
            error: `--${flagName}: ${rounded} is below the minimum of ${spec.min}`,
        };
    }
    if (rounded > spec.max) {
        return {
            ok: false,
            error: `--${flagName}: ${rounded} is above the maximum of ${spec.max}`,
        };
    }
    return { ok: true, value: rounded };
}

/**
 * Builds a SandboxOptions object from parsed CLI values and a pre-computed
 * maxOutputBytes limit. Used directly by nanalogue-sandbox-exec; nanalogue-chat
 * passes sandbox settings through AiChatConfig to the orchestrator instead.
 *
 * Collects all argument errors before throwing so callers see every problem
 * at once rather than one at a time.
 *
 * @param values - Parsed sandbox-related CLI values (from SANDBOX_ARG_DEFS).
 * @param maxOutputBytes - Pre-computed output byte ceiling.
 * @returns A SandboxOptions object ready for runSandboxCode.
 * @throws {Error} If any argument value is non-numeric or outside its allowed range.
 */
export function buildSandboxRunOptions(
    values: SandboxArgValues,
    maxOutputBytes: number,
): SandboxOptions {
    const errors: string[] = [];

    /**
     * Calls parseNumericArg, accumulates any error, and returns fallback on failure.
     *
     * @param flagName - CLI flag name without leading dashes, used in error messages.
     * @param value - Raw string from parseArgs, or undefined if the flag was omitted.
     * @param spec - Allowed range and fallback for the field.
     * @returns The parsed integer on success, or the spec fallback on failure.
     */
    function checked(
        flagName: string,
        value: string | undefined,
        spec: NumericArgSpec,
    ): number {
        const result = parseNumericArg(flagName, value, spec);
        if (!result.ok) {
            errors.push(result.error);
            return spec.fallback;
        }
        return result.value;
    }

    const sandboxOptions: SandboxOptions = {
        maxRecordsReadInfo: checked(
            "max-records-read-info",
            values["max-records-read-info"],
            CONFIG_FIELD_SPECS.maxRecordsReadInfo,
        ),
        maxRecordsBamMods: checked(
            "max-records-bam-mods",
            values["max-records-bam-mods"],
            CONFIG_FIELD_SPECS.maxRecordsBamMods,
        ),
        maxRecordsWindowReads: checked(
            "max-records-window-reads",
            values["max-records-window-reads"],
            CONFIG_FIELD_SPECS.maxRecordsWindowReads,
        ),
        maxRecordsSeqTable: checked(
            "max-records-seq-table",
            values["max-records-seq-table"],
            CONFIG_FIELD_SPECS.maxRecordsSeqTable,
        ),
        maxDurationSecs: checked(
            "max-duration-secs",
            values["max-duration-secs"],
            CONFIG_FIELD_SPECS.maxDurationSecs,
        ),
        maxMemory:
            checked(
                "max-memory-mb",
                values["max-memory-mb"],
                CONFIG_FIELD_SPECS.maxMemoryMB,
            ) *
            1024 *
            1024,
        maxAllocations: checked(
            "max-allocations",
            values["max-allocations"],
            CONFIG_FIELD_SPECS.maxAllocations,
        ),
        maxReadBytes:
            checked(
                "max-read-mb",
                values["max-read-mb"],
                CONFIG_FIELD_SPECS.maxReadMB,
            ) *
            1024 *
            1024,
        maxWriteBytes:
            checked(
                "max-write-mb",
                values["max-write-mb"],
                CONFIG_FIELD_SPECS.maxWriteMB,
            ) *
            1024 *
            1024,
        maxOutputBytes,
    };

    if (errors.length > 0) {
        throw new Error(errors.join("\n"));
    }

    return sandboxOptions;
}
