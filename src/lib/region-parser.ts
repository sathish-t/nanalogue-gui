// Parses and validates genomic region strings (e.g. "chr3", "chrI:1000-50000")
// against a set of known contig names and their lengths.

/**
 * Successful region parse result with contig name and optional 1-based coordinates.
 */
export interface ValidRegion {
    /** Whether the parse succeeded. */
    valid: true;
    /** The matched contig/reference name. */
    contig: string;
    /** 1-based start position, if a range was specified. */
    start?: number;
    /** 1-based end position (inclusive), if a range was specified. */
    end?: number;
}

/**
 * Failed region parse result with a human-readable reason.
 */
interface InvalidRegion {
    /** Whether the parse succeeded. */
    valid: false;
    /** A human-readable description of why parsing failed. */
    reason: string;
}

/**
 * Result of parsing a genomic region string.
 */
export type RegionParseResult = ValidRegion | InvalidRegion;

/** Pattern matching a single integer (e.g. "4000"). */
const SINGLE_RE = /^(\d+)$/;

/** Pattern matching a range of two integers (e.g. "1000-50000"). */
const RANGE_RE = /^(\d+)-(\d+)$/;

/**
 * Parses a genomic region string against a known set of contigs.
 *
 * Accepted forms:
 * - `"chr3"` — whole contig (bare name)
 * - `"chrI:1000-50000"` — contig with 1-based range.
 *
 * Rejected forms:
 * - `"chr3:4000"` — single-position (ambiguous / not useful for QC)
 * - Unknown contig names
 * - Out-of-bounds coordinates.
 *
 * @param input - The raw region string from user input.
 * @param contigs - Map of known contig names to their lengths in base pairs.
 * @returns A result indicating success with parsed fields, or failure with a reason.
 */
export function parseRegion(
    input: string,
    contigs: Record<string, number>,
): RegionParseResult {
    const str = input.trim();
    if (str.length === 0) {
        return { valid: false, reason: "Region string is empty." };
    }

    const colonIdx = str.lastIndexOf(":");

    if (colonIdx >= 0) {
        const prefix = str.substring(0, colonIdx);
        const suffix = str.substring(colonIdx + 1);

        const singleMatch = SINGLE_RE.exec(suffix);
        const rangeMatch = RANGE_RE.exec(suffix);

        if (singleMatch || rangeMatch) {
            // Suffix is plausibly numeric — check ambiguity first
            const prefixKnown = prefix in contigs;
            const strKnown = str in contigs;

            if (prefixKnown && strKnown) {
                return {
                    valid: false,
                    reason: `Ambiguous region: both "${prefix}" and "${str}" are known reference sequences.`,
                };
            }

            if (prefixKnown) {
                if (singleMatch) {
                    return {
                        valid: false,
                        reason: `Single-position regions like "${str}" are not supported. Use a range like ${prefix}:START-END.`,
                    };
                }

                if (!rangeMatch) {
                    return {
                        valid: false,
                        reason: `Invalid region syntax: "${str}". Use CONTIG or CONTIG:START-END format.`,
                    };
                }

                const start = Number(rangeMatch[1]);
                const end = Number(rangeMatch[2]);
                const contigLength = contigs[prefix];

                if (start < 1) {
                    return {
                        valid: false,
                        reason: `Start position must be at least 1 (got ${start}).`,
                    };
                }

                if (start >= end) {
                    return {
                        valid: false,
                        reason: `Start position (${start}) must be less than end position (${end}).`,
                    };
                }

                if (end > contigLength) {
                    return {
                        valid: false,
                        reason: `End position (${end}) exceeds ${prefix} length (${contigLength}).`,
                    };
                }

                return { valid: true, contig: prefix, start, end };
            }

            if (strKnown) {
                return { valid: true, contig: str };
            }

            return {
                valid: false,
                reason: `Unknown reference sequence: "${prefix}".`,
            };
        }

        // Suffix not plausibly numeric — fall through to whole-string lookup
    }

    // No colon, or suffix was not numeric
    if (str in contigs) {
        return { valid: true, contig: str };
    }

    if (colonIdx >= 0) {
        return {
            valid: false,
            reason: `Invalid region syntax: "${str}". Use CONTIG or CONTIG:START-END format.`,
        };
    }

    return {
        valid: false,
        reason: `Unknown reference sequence: "${str}".`,
    };
}

/**
 * Checks that a mod region overlaps with the main region.
 *
 * Both arguments must be valid parsed regions. Returns null when the
 * mod region is acceptable, or a human-readable error string when it
 * is not (different contig, or disjoint coordinate ranges).
 *
 * @param region - The main analysis region.
 * @param modRegion - The modification-filtering sub-region.
 * @returns Null if valid, or an error message string if invalid.
 */
export function validateModRegionOverlap(
    region: ValidRegion,
    modRegion: ValidRegion,
): string | null {
    if (region.contig !== modRegion.contig) {
        return `Mod region contig "${modRegion.contig}" does not match region contig "${region.contig}".`;
    }
    // When one or both lack start/end, contig match alone is sufficient
    if (!region.start || !region.end || !modRegion.start || !modRegion.end) {
        return null;
    }
    // Both have coordinate ranges (inclusive endpoints) — reject if completely disjoint
    if (modRegion.end < region.start || modRegion.start > region.end) {
        return `Mod region ${modRegion.contig}:${modRegion.start}-${modRegion.end} does not overlap with region ${region.contig}:${region.start}-${region.end}.`;
    }
    return null;
}
