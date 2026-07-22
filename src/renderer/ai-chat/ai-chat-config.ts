// Advanced configuration helpers for the AI Chat renderer.

import { CONFIG_FIELD_SPECS } from "../../lib/ai-chat-shared-constants";
import { getAiChatElements } from "./ai-chat-elements";

const {
    btnBrowse,
    btnFetchModels,
    inputApiKey,
    inputDir,
    inputEndpoint,
    inputModel,
    optContextWindow,
    optMaxAllocations,
    optMaxBamMods,
    optMaxCodeRounds,
    optMaxDuration,
    optMaxMemory,
    optMaxReadInfo,
    optMaxReadMB,
    optMaxRetries,
    optMaxSeqTable,
    optMaxWindowReads,
    optMaxWriteMB,
    optTemperature,
    optTimeout,
} = getAiChatElements();

/**
 * Maps each advanced-option input element to its CONFIG_FIELD_SPECS key.
 *
 * Used by getConfig, applyConfigBounds, resetDefaults, and the config lock
 * helpers to avoid repeating the same element list in multiple places.
 */
const ADVANCED_OPTION_FIELDS: ReadonlyArray<
    readonly [HTMLInputElement, keyof typeof CONFIG_FIELD_SPECS]
> = [
    [optContextWindow, "contextWindowTokens"],
    [optMaxRetries, "maxRetries"],
    [optTimeout, "timeoutSeconds"],
    [optMaxReadInfo, "maxRecordsReadInfo"],
    [optMaxBamMods, "maxRecordsBamMods"],
    [optMaxWindowReads, "maxRecordsWindowReads"],
    [optMaxSeqTable, "maxRecordsSeqTable"],
    [optMaxCodeRounds, "maxCodeRounds"],
    [optMaxDuration, "maxDurationSecs"],
    [optMaxMemory, "maxMemoryMB"],
    [optMaxAllocations, "maxAllocations"],
    [optMaxReadMB, "maxReadMB"],
    [optMaxWriteMB, "maxWriteMB"],
] as const;

/**
 * Returns the current advanced options config values.
 *
 * @returns A config object with the current field values.
 */
export function getConfig(): Record<string, unknown> {
    /**
     * Parses a numeric input value, returning the fallback if the value is
     * not a finite number. Unlike `Number(x) || fallback`, this preserves 0.
     *
     * @param raw - The raw string from the input element.
     * @param fallback - The fallback value from CONFIG_FIELD_SPECS.
     * @returns The parsed number or the fallback.
     */
    const parse = (raw: string, fallback: number): number => {
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    };

    const config: Record<string, unknown> = {};
    for (const [input, key] of ADVANCED_OPTION_FIELDS) {
        config[key] = parse(input.value, CONFIG_FIELD_SPECS[key].fallback);
    }
    // Temperature is optional — empty string means undefined (omit from request)
    config.temperature = optTemperature.value.trim()
        ? Number.parseFloat(optTemperature.value)
        : undefined;
    return config;
}

/**
 * Disables all session config fields after the first successful send.
 */
export function lockSessionConfig(): void {
    inputDir.disabled = true;
    btnBrowse.disabled = true;
    inputEndpoint.disabled = true;
    inputApiKey.disabled = true;
    inputModel.disabled = true;
    btnFetchModels.disabled = true;
    for (const [input] of ADVANCED_OPTION_FIELDS) {
        input.disabled = true;
    }
    optTemperature.disabled = true;
}

/**
 * Re-enables all session config fields for a new chat.
 */
export function unlockSessionConfig(): void {
    inputDir.disabled = false;
    btnBrowse.disabled = false;
    inputEndpoint.disabled = false;
    inputApiKey.disabled = false;
    inputModel.disabled = false;
    btnFetchModels.disabled = false;
    for (const [input] of ADVANCED_OPTION_FIELDS) {
        input.disabled = false;
    }
    optTemperature.disabled = false;
}

/**
 * Applies min/max bounds to all numeric config inputs from CONFIG_FIELD_SPECS.
 */
export function applyConfigBounds(): void {
    for (const [input, key] of ADVANCED_OPTION_FIELDS) {
        const spec = CONFIG_FIELD_SPECS[key];
        input.min = String(spec.min);
        input.max = String(spec.max);
    }
}

/**
 * Resets the advanced options to default values.
 */
export function resetDefaults(): void {
    for (const [input, key] of ADVANCED_OPTION_FIELDS) {
        input.value = String(CONFIG_FIELD_SPECS[key].fallback);
    }
    optTemperature.value = "";
}

/**
 * Validates that required config fields are filled before sending.
 *
 * @returns An error message string, or null if valid.
 */
export function validateConfig(): string | null {
    if (!inputDir.value) return "Please select a BAM directory.";
    if (!inputEndpoint.value) return "Please enter an endpoint URL.";
    if (!inputModel.value) return "Please enter a model name.";
    return null;
}
