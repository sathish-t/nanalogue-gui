// Parsing checks for command-line option structure and comma-separated tool names.

/** Minimal parseArgs token shape needed for duplicate-option detection. */
interface CliArgumentToken {
    /** Token kind emitted by node:util parseArgs. */
    kind: string;
    /** Canonical long option name for option tokens. */
    name?: string;
}

/** Result of parsing removed sandbox tool names. */
export type RemovedToolNamesResult =
    | {
          /** Indicates successful parsing. */
          valid: true;
          /** Unique tool names in user-supplied order. */
          names: string[];
      }
    | {
          /** Indicates failed parsing. */
          valid: false;
          /** Concise validation error. */
          error: string;
      };

/**
 * Finds the first option supplied more than once.
 *
 * @param tokens - Tokens returned by parseArgs with tokens enabled.
 * @returns Duplicate canonical option name, or null when all options are unique.
 */
export function findDuplicateCliOption(
    tokens: readonly CliArgumentToken[],
): string | null {
    const seen = new Set<string>();
    for (const token of tokens) {
        if (token.kind !== "option" || token.name === undefined) continue;
        if (seen.has(token.name)) return token.name;
        seen.add(token.name);
    }
    return null;
}

/**
 * Parses a strict comma-separated list of known sandbox tool names.
 *
 * @param rawValue - Untrusted --rm-tools value.
 * @param validToolNames - Complete registry of accepted tool names.
 * @returns Unique tool names or a concise validation error.
 */
export function parseRemovedToolNames(
    rawValue: string,
    validToolNames: readonly string[],
): RemovedToolNamesResult {
    if (rawValue.length === 0) {
        return { valid: false, error: "--rm-tools value cannot be empty" };
    }
    const names = rawValue.split(",");
    const seen = new Set<string>();
    for (const name of names) {
        if (name.length === 0) {
            return {
                valid: false,
                error: "--rm-tools contains an empty entry",
            };
        }
        if (name !== name.trim()) {
            return {
                valid: false,
                error: "--rm-tools entries must not contain surrounding whitespace",
            };
        }
        if (name.length > 300) {
            return {
                valid: false,
                error: "--rm-tools entry exceeds 300 characters",
            };
        }
        if (!validToolNames.includes(name)) {
            return {
                valid: false,
                error: `--rm-tools contains unknown tool "${name}"`,
            };
        }
        if (seen.has(name)) {
            return { valid: false, error: `--rm-tools repeats tool "${name}"` };
        }
        seen.add(name);
    }
    return { valid: true, names };
}
