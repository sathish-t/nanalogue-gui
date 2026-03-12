// Config field specs and shared constants for the AI Chat feature.
// This module must remain free of Node-specific imports so esbuild can bundle it for the browser.

import type {
    AiChatConfig,
    ConfigFieldSpec,
    OptionalFloatFieldSpec,
} from "./chat-types";

export const /** Upper bound for maxCodeRounds to prevent runaway loops. */ MAX_CODE_ROUNDS_LIMIT = 50;

export const /** Validation specs for each integer AiChatConfig field (temperature excluded). */ CONFIG_FIELD_SPECS: Record<
        Exclude<keyof AiChatConfig, "temperature">,
        ConfigFieldSpec
    > = {
        /** System prompt alone reaches 3000-5000 tokens; 8k allows small local models. */
        contextWindowTokens: {
            min: 8_000,
            max: 2_000_000,
            fallback: 32_000,
            label: "context window tokens",
        },
        /** At least one attempt; cap to avoid runaway retry loops. */
        maxRetries: { min: 1, max: 20, fallback: 5, label: "max retries" },
        /** Per-request HTTP timeout; 1 s floor, 2-minute ceiling. */
        timeoutSeconds: {
            min: 1,
            max: 120,
            fallback: 60,
            label: "timeout seconds",
        },
        /** Floor of 1 record; ceiling of 1 M to prevent memory blowup. */
        maxRecordsReadInfo: {
            min: 1,
            max: 1_000_000,
            fallback: 200_000,
            label: "max read_info records",
        },
        /** Floor of 1 record; ceiling of 1 M to prevent memory blowup. */
        maxRecordsBamMods: {
            min: 1,
            max: 1_000_000,
            fallback: 5_000,
            label: "max bam_mods records",
        },
        /** Floor of 1 record; ceiling of 1 M to prevent memory blowup. */
        maxRecordsWindowReads: {
            min: 1,
            max: 1_000_000,
            fallback: 5_000,
            label: "max window_reads records",
        },
        /** Floor of 1 record; ceiling of 100 k (bounded by single-region read count). */
        maxRecordsSeqTable: {
            min: 1,
            max: 100_000,
            fallback: 5_000,
            label: "max seq_table records",
        },
        /** At least one round; cap to prevent runaway loops. */
        maxCodeRounds: {
            min: 1,
            max: MAX_CODE_ROUNDS_LIMIT,
            fallback: 10,
            label: "max code rounds",
        },
        /** Best-effort sandbox execution time limit; bash is cancelled at this limit, native reads in progress may complete in the background. */
        maxDurationSecs: {
            min: 1,
            max: 604_800,
            fallback: 600,
            label: "max execution time (seconds)",
        },
        /** Sandbox heap limit; 1 MB floor, 64 GB ceiling. */
        maxMemoryMB: {
            min: 1,
            max: 65_536,
            fallback: 512,
            label: "max sandbox memory (MB)",
        },
        /** Sandbox allocation count; 1 floor, 100 M ceiling. */
        maxAllocations: {
            min: 1,
            max: 100_000_000,
            fallback: 100_000,
            label: "max sandbox allocations",
        },
        /** Per read_file call limit; 1 MB floor, 100 MB ceiling (Buffer.alloc constraint). */
        maxReadMB: {
            min: 1,
            max: 100,
            fallback: 1,
            label: "max read_file size (MB)",
        },
        /** Per write_file call limit; 1 MB floor, 100 MB ceiling (V8 string length constraint). */
        maxWriteMB: {
            min: 1,
            max: 100,
            fallback: 50,
            label: "max write_file size (MB)",
        },
    };

export const /** Validation spec for optional temperature (float, no fallback). */ TEMPERATURE_SPEC: OptionalFloatFieldSpec =
        {
            min: 0,
            max: 2,
            label: "temperature",
        };

/**
 * Asserts that every field spec has min <= fallback <= max.
 * Called at module load to catch misconfigurations immediately.
 *
 * @throws {Error} If any spec violates the invariant.
 */
function validateConfigFieldSpecs(): void {
    for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
        if (spec.min > spec.max) {
            throw new Error(
                `CONFIG_FIELD_SPECS.${key}: min (${spec.min}) > max (${spec.max})`,
            );
        }
        if (spec.fallback < spec.min || spec.fallback > spec.max) {
            throw new Error(
                `CONFIG_FIELD_SPECS.${key}: fallback (${spec.fallback}) outside [${spec.min}, ${spec.max}]`,
            );
        }
    }
}

validateConfigFieldSpecs();
