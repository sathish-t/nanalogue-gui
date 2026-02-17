// Provider detection and model listing for multi-provider LLM endpoints.
// Maps endpoint URLs to Provider types and fetches available models.

import { MODEL_LIST_TIMEOUT_MS } from "./ai-chat-constants";

/** Supported LLM API provider types. */
export type Provider = "anthropic" | "google-gemini" | "openai-compat";

/** Successful model listing result. */
interface FetchModelsSuccess {
    /** Whether the fetch succeeded. */
    success: true;
    /** The list of available model identifiers. */
    models: string[];
}

/** Failed model listing result. */
interface FetchModelsFailure {
    /** Whether the fetch succeeded. */
    success: false;
    /** A human-readable error message. */
    error: string;
}

/** Result of a model listing request. */
export type FetchModelsResult = FetchModelsSuccess | FetchModelsFailure;

/**
 * Detects the API provider from an endpoint URL by inspecting its hostname.
 *
 * @param endpoint - The base URL of the LLM API endpoint.
 * @returns The detected provider, or "openai-compat" as a fallback.
 */
export function detectProvider(endpoint: string): Provider {
    let hostname: string;
    try {
        hostname = new URL(endpoint).hostname;
    } catch {
        return "openai-compat";
    }

    if (hostname === "api.anthropic.com") {
        return "anthropic";
    }
    if (hostname === "generativelanguage.googleapis.com") {
        return "google-gemini";
    }
    return "openai-compat";
}

/**
 * Maps well-known HTTP error status codes to user-friendly failure messages.
 *
 * @param status - The HTTP status code from the response.
 * @returns A failure result for known error codes, or null if unrecognised.
 */
function handleErrorStatus(status: number): FetchModelsFailure | null {
    if (status === 401 || status === 403) {
        return {
            success: false,
            error: "Authentication failed \u2014 check your API key",
        };
    }
    if (status === 404) {
        return {
            success: false,
            error: "Endpoint does not support model listing \u2014 type a model name manually",
        };
    }
    return null;
}

/**
 * Fetches available models from an OpenAI-compatible /models endpoint.
 *
 * @param baseUrl - The base URL of the API (e.g., "https://api.openai.com/v1").
 * @param apiKey - The Bearer token for authentication.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns A result containing the model list or an error message.
 */
async function fetchModelsOpenAiCompat(
    baseUrl: string,
    apiKey: string,
    timeoutMs: number,
): Promise<FetchModelsResult> {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {
        Accept: "application/json",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const knownError = handleErrorStatus(response.status);
        if (knownError) {
            return knownError;
        }
        return {
            success: false,
            error: `Unexpected response: ${response.status}`,
        };
    }

    const body = (await response.json()) as {
        /** The list of available models. */
        data?: Array<{
            /** The model identifier. */
            id: string;
        }>;
    };

    if (!body.data || !Array.isArray(body.data)) {
        return {
            success: false,
            error: "Unexpected response format from endpoint",
        };
    }

    return {
        success: true,
        models: body.data.map(
            (m: {
                /** The model identifier. */
                id: string;
            }) => m.id,
        ),
    };
}

/**
 * Fetches available models from the Anthropic /models endpoint.
 *
 * @param baseUrl - The base URL of the API (e.g., "https://api.anthropic.com/v1").
 * @param apiKey - The Anthropic API key (sent via x-api-key header).
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns A result containing the model list or an error message.
 */
async function fetchModelsAnthropic(
    baseUrl: string,
    apiKey: string,
    timeoutMs: number,
): Promise<FetchModelsResult> {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {
        Accept: "application/json",
        "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
        headers["x-api-key"] = apiKey;
    }

    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const knownError = handleErrorStatus(response.status);
        if (knownError) {
            return knownError;
        }
        return {
            success: false,
            error: `Unexpected response: ${response.status}`,
        };
    }

    const body = (await response.json()) as {
        /** The list of available models. */
        data?: Array<{
            /** The model identifier. */
            id: string;
        }>;
    };

    if (!body.data || !Array.isArray(body.data)) {
        return {
            success: false,
            error: "Unexpected response format from endpoint",
        };
    }

    return {
        success: true,
        models: body.data.map(
            (m: {
                /** The model identifier. */
                id: string;
            }) => m.id,
        ),
    };
}

/**
 * Fetches available models from the Google Gemini API.
 *
 * @param baseUrl - The base URL of the API (e.g., "https://generativelanguage.googleapis.com/v1beta").
 * @param apiKey - The Gemini API key (sent as a query parameter, not a header).
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns A result containing the model list or an error message.
 */
async function fetchModelsGoogleGemini(
    baseUrl: string,
    apiKey: string,
    timeoutMs: number,
): Promise<FetchModelsResult> {
    const encodedKey = encodeURIComponent(apiKey);
    const url = `${baseUrl.replace(/\/+$/, "")}/models?key=${encodedKey}`;

    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        const knownError = handleErrorStatus(response.status);
        if (knownError) {
            return knownError;
        }
        return {
            success: false,
            error: `Unexpected response: ${response.status}`,
        };
    }

    const body = (await response.json()) as {
        /** The list of available models. */
        models?: Array<{
            /** The full model name (e.g., "models/gemini-2.0-flash"). */
            name: string;
        }>;
    };

    if (!body.models || !Array.isArray(body.models)) {
        return {
            success: false,
            error: "Unexpected response format from endpoint",
        };
    }

    return {
        success: true,
        models: body.models.map(
            (m: {
                /** The full model name. */
                name: string;
            }) => m.name.replace(/^models\//, ""),
        ),
    };
}

/**
 * Fetches the list of available models from an LLM endpoint.
 *
 * @param endpointUrl - The base URL of the LLM API endpoint.
 * @param apiKey - The API key for authentication.
 * @param providerOverride - Forces a specific provider instead of auto-detecting.
 * @param timeoutMs - Request timeout in milliseconds (defaults to MODEL_LIST_TIMEOUT_MS).
 * @returns A result containing the model list or an error message.
 */
export async function fetchModels(
    endpointUrl: string,
    apiKey: string,
    providerOverride?: Provider,
    timeoutMs?: number,
): Promise<FetchModelsResult> {
    const provider = providerOverride ?? detectProvider(endpointUrl);
    const timeout = timeoutMs ?? MODEL_LIST_TIMEOUT_MS;

    try {
        switch (provider) {
            case "anthropic":
                return await fetchModelsAnthropic(endpointUrl, apiKey, timeout);
            case "google-gemini":
                return await fetchModelsGoogleGemini(
                    endpointUrl,
                    apiKey,
                    timeout,
                );
            case "openai-compat":
                return await fetchModelsOpenAiCompat(
                    endpointUrl,
                    apiKey,
                    timeout,
                );
        }
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "TimeoutError") {
            return { success: false, error: "Request timed out" };
        }
        return { success: false, error: "Could not reach endpoint" };
    }
}
