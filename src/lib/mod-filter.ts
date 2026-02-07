// Parses modification filter strings into tag and strand components.

/**
 * Result of parsing a modification filter string.
 */
export interface ModFilterResult {
    /** The modification tag code extracted from the filter string. */
    tag?: string;
    /** The modification strand direction parsed from the sign prefix. */
    modStrand?: "bc" | "bc_comp";
}

/**
 * Parses a modification filter string into a tag and strand direction.
 *
 * Accepts formats like "+T", "-m", "+a" — a "+" or "-" prefix is required.
 * Trims whitespace from both the overall input and the tag portion.
 * Returns an empty result for empty strings, bare signs, or tags without a sign prefix.
 *
 * @param filter - The modification filter string, prefixed with "+" or "-".
 * @returns An object containing the parsed tag and modification strand direction.
 */
export function parseModFilter(filter: string): ModFilterResult {
    const trimmed = filter.trim();
    if (!trimmed) return {};

    const match = trimmed.match(/^([+-])(.+)$/);
    if (!match) return {};

    const [, sign, rawTag] = match;
    const tag = rawTag.trim();
    if (!tag) return {};

    return {
        tag,
        modStrand: sign === "+" ? "bc" : "bc_comp",
    };
}
