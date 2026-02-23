// Config field specs shared between main process and renderer.
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
        /** Minimum meaningful request time vs. 10-minute hard ceiling. */
        timeoutSeconds: {
            min: 10,
            max: 600,
            fallback: 120,
            label: "timeout seconds",
        },
        /** Floor prevents degenerate queries; ceiling prevents memory blowup. */
        maxRecordsReadInfo: {
            min: 100,
            max: 1_000_000,
            fallback: 200_000,
            label: "max read_info records",
        },
        /** Floor prevents degenerate queries; ceiling prevents memory blowup. */
        maxRecordsBamMods: {
            min: 100,
            max: 100_000,
            fallback: 5_000,
            label: "max bam_mods records",
        },
        /** Floor prevents degenerate queries; ceiling prevents memory blowup. */
        maxRecordsWindowReads: {
            min: 100,
            max: 100_000,
            fallback: 5_000,
            label: "max window_reads records",
        },
        /** Floor prevents degenerate queries; ceiling prevents memory blowup. */
        maxRecordsSeqTable: {
            min: 100,
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
