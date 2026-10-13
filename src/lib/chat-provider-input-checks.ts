// Validation for endpoint URL, API key, and model inputs used by chat providers.

const ENDPOINT_URL_MAX_LENGTH = 1000;
const API_KEY_MAX_LENGTH = 200;
const MODEL_MAX_LENGTH = 200;
const HTTP_URL_PREFIX = /^https?:\/\/[^/\\]/iu;
const INVALID_URL_CHARACTER = /[\p{White_Space}\\]/u;
const VISIBLE_ASCII_CHARACTERS = /^[!-~]*$/u;

/**
 * Checks for a credential-free HTTP or HTTPS URL without raw whitespace or backslashes.
 *
 * @param endpointUrl - Chat provider endpoint URL.
 * @returns Whether the endpoint URL has a hostname and satisfies syntax and length constraints.
 */
export function isValidEndpointUrl(endpointUrl: string): boolean {
    if (
        endpointUrl.length === 0 ||
        endpointUrl.length > ENDPOINT_URL_MAX_LENGTH ||
        INVALID_URL_CHARACTER.test(endpointUrl) ||
        !HTTP_URL_PREFIX.test(endpointUrl)
    ) {
        return false;
    }

    try {
        const parsedUrl = new URL(endpointUrl);
        return (
            (parsedUrl.protocol === "http:" ||
                parsedUrl.protocol === "https:") &&
            parsedUrl.hostname.length > 0 &&
            parsedUrl.username.length === 0 &&
            parsedUrl.password.length === 0
        );
    } catch {
        return false;
    }
}

/**
 * Checks whether an optional API key contains at most 200 visible ASCII characters.
 *
 * @param apiKey - Chat provider API key.
 * @returns Whether the API key is empty or satisfies the visible-ASCII and length constraints.
 */
export function isValidApiKey(apiKey: string): boolean {
    return (
        apiKey.length <= API_KEY_MAX_LENGTH &&
        VISIBLE_ASCII_CHARACTERS.test(apiKey)
    );
}

/**
 * Checks whether a model name has an allowed length and no surrounding whitespace.
 *
 * @param model - Chat provider model name.
 * @returns Whether the model name satisfies length and whitespace constraints.
 */
export function isValidModel(model: string): boolean {
    return (
        model.length > 0 &&
        model.length <= MODEL_MAX_LENGTH &&
        model === model.trim()
    );
}
