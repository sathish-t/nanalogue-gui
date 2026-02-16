// Per-channel IPC payload validation for AI Chat mode.
// Renderer input is treated as untrusted at the main-process boundary.

import { isAbsolute } from "node:path";
import { CONFIG_FIELD_SPECS, MAX_MESSAGE_BYTES } from "./ai-chat-constants";
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

/** Successful URL validation result. */
interface ValidUrlResult {
    /** Indicates the URL passed validation. */
    ok: true;
    /** The parsed URL object. */
    url: URL;
}

/** Failed URL validation result. */
interface InvalidUrlResult {
    /** Indicates the URL failed validation. */
    ok: false;
    /** Description of the URL validation failure. */
    error: string;
}

/** Result of URL validation. */
type UrlValidationResult = ValidUrlResult | InvalidUrlResult;

/** Validated payload for ai-chat-list-models. */
export interface ListModelsPayload {
    /** The endpoint URL to query for models. */
    endpointUrl: string;
    /** The API key (may be empty). */
    apiKey: string;
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
}

/**
 * Validates a URL string, rejecting malformed URLs and embedded credentials.
 *
 * @param url - The URL string to validate.
 * @returns The parsed URL or an error string.
 */
function validateUrl(url: string): UrlValidationResult {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: `Invalid URL: ${url}` };
    }
    if (parsed.username || parsed.password) {
        return {
            ok: false,
            error: "URL must not contain embedded credentials",
        };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
            ok: false,
            error: `Unsupported URL scheme: ${parsed.protocol}`,
        };
    }
    return { ok: true, url: parsed };
}

/**
 * Validates a numeric config field against its spec.
 *
 * Non-numeric or missing values fall back to the spec default.
 * Numeric values outside [min, max] are rejected with an error string.
 * Valid numbers are rounded to the nearest integer.
 *
 * @param value - The raw input value.
 * @param spec - The field specification with min, max, fallback, and label.
 * @returns The validated integer, or an error string.
 */
function validateNumber(
    value: unknown,
    spec: ConfigFieldSpec,
): number | string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return spec.fallback;
    }
    const rounded = Math.round(value);
    if (rounded < spec.min || rounded > spec.max) {
        return `${spec.label} must be between ${spec.min.toLocaleString()} and ${spec.max.toLocaleString()} (got ${rounded.toLocaleString()})`;
    }
    return rounded;
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
    const urlResult = validateUrl(p.endpointUrl);
    if (!urlResult.ok) return { valid: false, error: urlResult.error };

    const apiKey = typeof p.apiKey === "string" ? p.apiKey : "";

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
    const urlResult = validateUrl(p.endpointUrl);
    if (!urlResult.ok) return { valid: false, error: urlResult.error };

    const apiKey = typeof p.apiKey === "string" ? p.apiKey : "";

    if (typeof p.model !== "string" || p.model.length === 0) {
        return { valid: false, error: "model is required" };
    }

    if (typeof p.message !== "string" || p.message.length === 0) {
        return { valid: false, error: "message is required" };
    }
    if (Buffer.byteLength(p.message, "utf-8") > MAX_MESSAGE_BYTES) {
        return { valid: false, error: "message exceeds 100 KB limit" };
    }

    if (typeof p.allowedDir !== "string" || p.allowedDir.length === 0) {
        return { valid: false, error: "allowedDir is required" };
    }
    if (!isAbsolute(p.allowedDir)) {
        return { valid: false, error: "allowedDir must be an absolute path" };
    }

    const rawConfig =
        typeof p.config === "object" && p.config !== null
            ? (p.config as Record<string, unknown>)
            : {};

    const configErrors: string[] = [];
    const configValues = {} as Record<string, number>;
    for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
        const result = validateNumber(rawConfig[key], spec);
        if (typeof result === "string") {
            configErrors.push(result);
        } else {
            configValues[key] = result;
        }
    }
    if (configErrors.length > 0) {
        return { valid: false, error: configErrors.join("; ") };
    }
    const config = configValues as unknown as AiChatConfig;

    return {
        valid: true,
        data: {
            endpointUrl: p.endpointUrl,
            apiKey,
            model: p.model,
            message: p.message,
            allowedDir: p.allowedDir,
            config,
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
