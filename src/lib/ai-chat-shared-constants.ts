// Config field specs shared between main process and renderer.
// This module must remain free of Node-specific imports so esbuild can bundle it for the browser.

import type { AiChatConfig, ConfigFieldSpec } from "./chat-types";

export const /** Validation specs for each AiChatConfig field. */ CONFIG_FIELD_SPECS: Record<
        keyof AiChatConfig,
        ConfigFieldSpec
    > = {
        /** Smallest useful context window vs. Largest models available today. */
        contextWindowTokens: {
            min: 1_000,
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
