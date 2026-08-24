// Browser-safe parsing and measurement for chat user inputs.

const CANONICAL_UNSIGNED_INTEGER = /^\d+$/u;
const CANONICAL_UNSIGNED_DECIMAL = /^(?:\d+|\d+\.\d+)$/u;

/** Inclusive numeric range required for canonical integer parsing. */
interface IntegerRange {
    /** Minimum accepted value. */
    min: number;
    /** Maximum accepted value. */
    max: number;
}

/** Result of parsing a bounded canonical integer. */
export type CanonicalIntegerResult =
    | {
          /** Indicates successful parsing. */
          valid: true;
          /** Parsed integer value. */
          value: number;
      }
    | {
          /** Indicates failed parsing. */
          valid: false;
          /** Concise reason suitable for CLI errors or GUI alerts. */
          error: string;
      };

/** Result of parsing an optional canonical temperature. */
export type CanonicalTemperatureResult =
    | {
          /** Indicates successful parsing. */
          valid: true;
          /** Parsed temperature, or undefined when omitted. */
          value: number | undefined;
      }
    | {
          /** Indicates failed parsing. */
          valid: false;
          /** Concise reason suitable for CLI errors or GUI alerts. */
          error: string;
      };

/**
 * Returns the UTF-8 byte length of browser or Node text.
 *
 * @param value - Text whose encoded size is required.
 * @returns UTF-8 byte count.
 */
export function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * Parses decimal digits as an integer and enforces a configured range.
 *
 * @param fieldName - User-facing flag or field name.
 * @param rawValue - Untrusted text value.
 * @param spec - Inclusive range and fallback metadata.
 * @returns Parsed value or a concise validation error.
 */
export function parseCanonicalInteger(
    fieldName: string,
    rawValue: string,
    spec: IntegerRange,
): CanonicalIntegerResult {
    if (rawValue.length >= 20 || !/^[-+.\d]*$/u.test(rawValue)) {
        return {
            valid: false,
            error: `${fieldName} input must be shorter than 20 characters and contain only signs, a decimal point, or digits`,
        };
    }
    if (!CANONICAL_UNSIGNED_INTEGER.test(rawValue)) {
        return {
            valid: false,
            error: `${fieldName} must contain decimal digits only`,
        };
    }
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        return { valid: false, error: `${fieldName} is too large` };
    }
    if (value < spec.min || value > spec.max) {
        return {
            valid: false,
            error: `${fieldName} must be between ${spec.min} and ${spec.max}`,
        };
    }
    return { valid: true, value };
}

/**
 * Parses an optional plain-decimal LLM sampling temperature from 0 through 2.
 *
 * @param fieldName - User-facing flag or field name.
 * @param rawValue - Untrusted text value; an empty string means omitted.
 * @returns Parsed temperature, omission, or a concise validation error.
 */
export function parseCanonicalTemperature(
    fieldName: string,
    rawValue: string,
): CanonicalTemperatureResult {
    if (getUtf8ByteLength(rawValue) >= 10 || !/^[-+.\d]*$/u.test(rawValue)) {
        return {
            valid: false,
            error: `${fieldName} input must be shorter than 10 bytes and contain only signs, a decimal point, or digits`,
        };
    }
    if (rawValue === "") return { valid: true, value: undefined };
    if (!CANONICAL_UNSIGNED_DECIMAL.test(rawValue)) {
        return {
            valid: false,
            error: `${fieldName} must be a plain decimal number between 0 and 2`,
        };
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 2) {
        return {
            valid: false,
            error: `${fieldName} must be between 0 and 2`,
        };
    }
    return { valid: true, value };
}
