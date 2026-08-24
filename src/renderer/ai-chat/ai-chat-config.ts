// Advanced configuration helpers for the AI Chat renderer.

import {
    CONFIG_FIELD_SPECS,
    MAX_INPUT_PATH_LENGTH,
} from "../../lib/ai-chat-shared-constants";
import {
    isValidApiKey,
    isValidEndpointUrl,
    isValidModel,
} from "../../lib/chat-provider-input-checks";
import {
    parseCanonicalInteger,
    parseCanonicalTemperature,
} from "../../lib/chat-user-input-parsing";
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
    optOnlySystemAppend,
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

/** Result of parsing every advanced configuration input. */
type AdvancedConfigInputResult =
    | {
          /** Indicates all inputs passed validation. */
          valid: true;
          /** Parsed values ready for IPC. */
          config: Record<string, number | undefined>;
      }
    | {
          /** Indicates at least one input failed validation. */
          valid: false;
          /** Concise validation failure. */
          error: string;
      };

/**
 * Validates and parses every advanced configuration input.
 *
 * @returns Parsed config values or the first validation failure.
 */
function parseAdvancedConfigInput(): AdvancedConfigInputResult {
    const config: Record<string, number | undefined> = {};
    for (const [input, key] of ADVANCED_OPTION_FIELDS) {
        const spec = CONFIG_FIELD_SPECS[key];
        const result = parseCanonicalInteger(spec.label, input.value, spec);
        if (!result.valid) return result;
        config[key] = result.value;
    }
    const temperatureResult = parseCanonicalTemperature(
        "temperature",
        optTemperature.value,
    );
    if (!temperatureResult.valid) return temperatureResult;
    config.temperature = temperatureResult.value;
    return { valid: true, config };
}

/**
 * Returns validated and parsed current advanced options config values.
 *
 * @returns A config object with the current field values.
 * @throws {Error} If any advanced configuration input is invalid.
 */
export function getConfig(): Record<string, unknown> {
    const result = parseAdvancedConfigInput();
    if (!result.valid) throw new Error(result.error);
    return result.config;
}

/**
 * Validates every advanced numeric option using strict canonical syntax.
 *
 * @returns An alert message string, or null when all advanced options are valid.
 */
export function validateAdvancedConfig(): string | null {
    const result = parseAdvancedConfigInput();
    return result.valid ? null : `Invalid ${result.error}.`;
}

/**
 * Disables all session config fields after prompt preflight accepts the session.
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
    optOnlySystemAppend.disabled = true;
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
    optOnlySystemAppend.disabled = false;
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
    optOnlySystemAppend.checked = false;
}

/**
 * Validates the provider fields required to fetch models.
 *
 * @returns An alert message string, or null if the endpoint and API key are valid.
 */
export function validateConnectionConfig(): string | null {
    if (!inputEndpoint.value) return "Please enter an endpoint URL.";
    if (!isValidEndpointUrl(inputEndpoint.value)) {
        return "Invalid endpoint URL.";
    }
    if (!isValidApiKey(inputApiKey.value)) return "Invalid API key.";
    return null;
}

/**
 * Validates that required config fields are filled before sending.
 *
 * @returns An alert message string, or null if valid.
 */
export function validateConfig(): string | null {
    if (!inputDir.value) return "Please select a BAM directory.";
    if (
        inputDir.value !== inputDir.value.trim() ||
        inputDir.value.length > MAX_INPUT_PATH_LENGTH
    ) {
        return "Invalid BAM directory path.";
    }
    const connectionError = validateConnectionConfig();
    if (connectionError) return connectionError;
    if (!inputModel.value) return "Please enter a model name.";
    if (!isValidModel(inputModel.value)) return "Invalid model name.";
    return validateAdvancedConfig();
}
