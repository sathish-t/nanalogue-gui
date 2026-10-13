// Per-channel IPC payload validation for AI Chat mode.
// Renderer input is treated as untrusted at the main-process boundary.

import { isAbsolute } from "node:path";
import {
    CONFIG_FIELD_SPECS,
    MAX_MESSAGE_BYTES,
    TEMPERATURE_SPEC,
} from "./ai-chat-constants";
import {
    isValidApiKey,
    isValidEndpointUrl,
    isValidModel,
} from "./chat-provider-input-checks";
import type { AiChatConfig, ConfigFieldSpec } from "./chat-types";

/** Successful validation result with typed data. */
interface ValidResult<T> {
    /** Indicates the payload passed validation. */
    valid: true;
    /** The validated and sanitized data. */
    data: T;
}

/** Failed validation result with error message. */
interface InvalidResult {
    /** Indicates the payload failed validation. */
    valid: false;
    /** Description of the validation failure. */
    error: string;
}

/** Result of IPC payload validation. */
type ValidationResult<T> = ValidResult<T> | InvalidResult;

/** Validated payload for ai-chat-list-models. */
export interface ListModelsPayload {
    /** The endpoint URL to query for models. */
    endpointUrl: string;
    /** The API key (may be empty). */
    apiKey: string;
}

/** Validated payload for ai-chat-get-system-prompt. */
export interface GetSystemPromptPayload {
    /** The orchestrator configuration used to build the prompt. */
    config: AiChatConfig;
    /**
     * The analysis directory used to look up SYSTEM_APPEND.md.
     * Optional — when absent the prompt is shown without any custom append.
     */
    allowedDir?: string;
    /** Whether SYSTEM_APPEND.md should replace the built-in sandbox prompt. */
    onlySystemAppend?: boolean;
}

/** Validated payload for ai-chat-send-message. */
export interface SendMessagePayload {
    /** The LLM endpoint URL. */
    endpointUrl: string;
    /** The API key (may be empty). */
    apiKey: string;
    /** The model name to use. */
    model: string;
    /** The user's message text. */
    message: string;
    /** The allowed directory for file operations. */
    allowedDir: string;
    /** The orchestrator configuration. */
    config: AiChatConfig;
    /** Whether SYSTEM_APPEND.md should replace the built-in sandbox prompt. */
    onlySystemAppend?: boolean;
}

/**
 * Validates the optional SYSTEM_APPEND-only prompt mode flag.
 *
 * @param value - The untrusted onlySystemAppend field value.
 * @returns The boolean or undefined when valid, otherwise an error.
 */
function validateOnlySystemAppend(
    value: unknown,
): ValidationResult<boolean | undefined> {
    if (value !== undefined && typeof value !== "boolean") {
        return {
            valid: false,
            error: "onlySystemAppend must be a boolean",
        };
    }
    return { valid: true, data: value as boolean | undefined };
}

/**
 * Validates a numeric config field against its spec.
 *
 * Missing values fall back to the spec default. Present values must be finite
 * integers inside [min, max].
 *
 * @param value - The raw input value.
 * @param spec - The field specification with min, max, fallback, and label.
 * @returns The validated integer, or an error string.
 */
function validateNumber(
    value: unknown,
    spec: ConfigFieldSpec,
): number | string {
    if (value === undefined) {
        return spec.fallback;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        return `${spec.label} must be an integer`;
    }
    if (value < spec.min || value > spec.max) {
        return `${spec.label} must be between ${spec.min.toLocaleString()} and ${spec.max.toLocaleString()} (got ${value.toLocaleString()})`;
    }
    return value;
}

/**
 * Validates a raw config object against CONFIG_FIELD_SPECS and TEMPERATURE_SPEC.
 *
 * Iterates over all integer field specs, falling back only for missing values
 * and rejecting malformed present values. Temperature is handled separately
 * as an optional float. Returns a typed AiChatConfig on success or an error
 * string collecting all violations.
 *
 * @param raw - The raw config record (treated as untrusted input).
 * @returns A validated AiChatConfig or a semicolon-separated error string.
 */
function validateConfig(raw: Record<string, unknown>): AiChatConfig | string {
    const configErrors: string[] = [];
    const configValues = {} as Record<string, number>;
    for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
        const result = validateNumber(raw[key], spec);
        if (typeof result === "string") {
            configErrors.push(result);
        } else {
            configValues[key] = result;
        }
    }

    // Temperature is optional and float-valued — handled separately from
    // the integer CONFIG_FIELD_SPECS loop (no Math.round, no fallback).
    let temperature: number | undefined;
    if (raw.temperature !== undefined) {
        if (
            typeof raw.temperature !== "number" ||
            !Number.isFinite(raw.temperature)
        ) {
            configErrors.push("temperature must be a finite number");
        } else if (
            raw.temperature < TEMPERATURE_SPEC.min ||
            raw.temperature > TEMPERATURE_SPEC.max
        ) {
            configErrors.push(
                `${TEMPERATURE_SPEC.label} must be between ${TEMPERATURE_SPEC.min} and ${TEMPERATURE_SPEC.max} (got ${raw.temperature})`,
            );
        } else {
            temperature = raw.temperature;
        }
    }

    if (configErrors.length > 0) {
        return configErrors.join("; ");
    }

    return {
        ...configValues,
        temperature,
    } as unknown as AiChatConfig;
}

/**
 * Validates the payload for the ai-chat-get-system-prompt IPC channel.
 *
 * The config field is optional. Missing fields use spec defaults, while
 * malformed present fields are rejected. An absent config object is treated
 * the same as an empty one.
 *
 * @param payload - The raw IPC payload.
 * @returns A validation result with the typed payload.
 */
export function validateGetSystemPrompt(
    payload: unknown,
): ValidationResult<GetSystemPromptPayload> {
    if (typeof payload !== "object" || payload === null) {
        return { valid: false, error: "Payload must be an object" };
    }
    const p = payload as Record<string, unknown>;

    if (
        p.config !== undefined &&
        (typeof p.config !== "object" ||
            p.config === null ||
            Array.isArray(p.config))
    ) {
        return { valid: false, error: "config must be an object" };
    }
    const rawConfig = (p.config as Record<string, unknown> | undefined) ?? {};

    const configResult = validateConfig(rawConfig);
    if (typeof configResult === "string") {
        return { valid: false, error: configResult };
    }

    const onlySystemAppendResult = validateOnlySystemAppend(p.onlySystemAppend);
    if (!onlySystemAppendResult.valid) return onlySystemAppendResult;
    const onlySystemAppend = onlySystemAppendResult.data;

    // allowedDir is optional unless onlySystemAppend is requested — that mode
    // requires SYSTEM_APPEND.md to be looked up in a real analysis directory.
    if (
        p.allowedDir !== undefined &&
        (typeof p.allowedDir !== "string" ||
            p.allowedDir.length === 0 ||
            !isAbsolute(p.allowedDir))
    ) {
        return { valid: false, error: "allowedDir must be an absolute path" };
    }
    const allowedDir = p.allowedDir as string | undefined;
    if (onlySystemAppend && allowedDir === undefined) {
        return {
            valid: false,
            error: "allowedDir is required when only-system-append is enabled",
        };
    }

    return {
        valid: true,
        data: { config: configResult, allowedDir, onlySystemAppend },
    };
}

/**
 * Validates the payload for the ai-chat-list-models IPC channel.
 *
 * @param payload - The raw IPC payload.
 * @returns A validation result with the typed payload.
 */
export function validateListModels(
    payload: unknown,
): ValidationResult<ListModelsPayload> {
    if (typeof payload !== "object" || payload === null) {
        return { valid: false, error: "Payload must be an object" };
    }
    const p = payload as Record<string, unknown>;

    if (typeof p.endpointUrl !== "string" || p.endpointUrl.length === 0) {
        return { valid: false, error: "endpointUrl is required" };
    }
    if (!isValidEndpointUrl(p.endpointUrl)) {
        return { valid: false, error: "Invalid endpoint URL" };
    }

    if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
        return { valid: false, error: "apiKey must be a string" };
    }
    const apiKey = p.apiKey ?? "";
    if (!isValidApiKey(apiKey)) {
        return { valid: false, error: "Invalid API key" };
    }

    return {
        valid: true,
        data: { endpointUrl: p.endpointUrl, apiKey },
    };
}

/**
 * Validates the payload for the ai-chat-send-message IPC channel.
 *
 * @param payload - The raw IPC payload.
 * @returns A validation result with the typed payload.
 */
export function validateSendMessage(
    payload: unknown,
): ValidationResult<SendMessagePayload> {
    if (typeof payload !== "object" || payload === null) {
        return { valid: false, error: "Payload must be an object" };
    }
    const p = payload as Record<string, unknown>;

    if (typeof p.endpointUrl !== "string" || p.endpointUrl.length === 0) {
        return { valid: false, error: "endpointUrl is required" };
    }
    if (!isValidEndpointUrl(p.endpointUrl)) {
        return { valid: false, error: "Invalid endpoint URL" };
    }

    if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
        return { valid: false, error: "apiKey must be a string" };
    }
    const apiKey = p.apiKey ?? "";
    if (!isValidApiKey(apiKey)) {
        return { valid: false, error: "Invalid API key" };
    }

    if (typeof p.model !== "string" || p.model.length === 0) {
        return { valid: false, error: "model is required" };
    }
    if (!isValidModel(p.model)) {
        return { valid: false, error: "Invalid model name" };
    }

    if (typeof p.message !== "string" || p.message.length === 0) {
        return { valid: false, error: "message is required" };
    }
    if (p.message.trim().length === 0) {
        return {
            valid: false,
            error: "message must not contain only whitespace",
        };
    }
    if (Buffer.byteLength(p.message, "utf-8") > MAX_MESSAGE_BYTES) {
        return { valid: false, error: "message exceeds 1 MiB limit" };
    }

    if (typeof p.allowedDir !== "string" || p.allowedDir.length === 0) {
        return { valid: false, error: "allowedDir is required" };
    }
    if (!isAbsolute(p.allowedDir)) {
        return { valid: false, error: "allowedDir must be an absolute path" };
    }

    if (
        p.config !== undefined &&
        (typeof p.config !== "object" ||
            p.config === null ||
            Array.isArray(p.config))
    ) {
        return { valid: false, error: "config must be an object" };
    }
    const rawConfig = (p.config as Record<string, unknown> | undefined) ?? {};

    const configResult = validateConfig(rawConfig);
    if (typeof configResult === "string") {
        return { valid: false, error: configResult };
    }

    const onlySystemAppendResult = validateOnlySystemAppend(p.onlySystemAppend);
    if (!onlySystemAppendResult.valid) return onlySystemAppendResult;
    const onlySystemAppend = onlySystemAppendResult.data;

    return {
        valid: true,
        data: {
            endpointUrl: p.endpointUrl,
            apiKey,
            model: p.model,
            message: p.message,
            allowedDir: p.allowedDir,
            config: configResult,
            onlySystemAppend,
        },
    };
}

/**
 * Validates an IPC payload for the specified channel.
 *
 * @param channel - The IPC channel name.
 * @param payload - The raw IPC payload.
 * @returns A validation result with the typed payload.
 */
export function validateIpcPayload(
    channel: string,
    payload: unknown,
): ValidationResult<unknown> {
    switch (channel) {
        case "ai-chat-get-system-prompt":
            return validateGetSystemPrompt(payload);
        case "ai-chat-list-models":
            return validateListModels(payload);
        case "ai-chat-send-message":
            return validateSendMessage(payload);
        case "ai-chat-cancel":
        case "ai-chat-new-chat":
        case "ai-chat-pick-directory":
        case "ai-chat-go-back":
            return { valid: true, data: null };
        default:
            return { valid: false, error: `Unknown channel: ${channel}` };
    }
}
