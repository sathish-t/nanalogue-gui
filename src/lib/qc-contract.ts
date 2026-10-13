import type { QCConfig } from "./types";

/** Numeric constraints for one QC request field. */
interface QCNumericConstraints {
    /** Inclusive lower bound. */
    min?: number;
    /** Inclusive upper bound. */
    max?: number;
    /** Whether the value must be a safe integer. */
    integer?: boolean;
}

/**
 * Validates one numeric QC request field.
 *
 * @param value - Untrusted field value.
 * @param field - Searchable field name for validation errors.
 * @param constraints - Numeric bounds and integer requirement.
 * @returns The validated number.
 */
function validateQCNumber(
    value: unknown,
    field: string,
    constraints: QCNumericConstraints = {},
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid QC request: ${field} must be a finite number`);
    }
    if (constraints.integer && !Number.isSafeInteger(value)) {
        throw new Error(`Invalid QC request: ${field} must be an integer`);
    }
    if (constraints.min !== undefined && value < constraints.min) {
        throw new Error(
            `Invalid QC request: ${field} must be at least ${constraints.min}`,
        );
    }
    if (constraints.max !== undefined && value > constraints.max) {
        throw new Error(
            `Invalid QC request: ${field} must be at most ${constraints.max}`,
        );
    }
    return value;
}

/**
 * Validates one optional numeric QC request field.
 *
 * @param value - Untrusted field value.
 * @param field - Searchable field name for validation errors.
 * @param constraints - Numeric bounds and integer requirement.
 * @returns The validated number, or undefined when absent.
 */
function validateOptionalQCNumber(
    value: unknown,
    field: string,
    constraints: QCNumericConstraints,
): number | undefined {
    return value === undefined
        ? undefined
        : validateQCNumber(value, field, constraints);
}

/**
 * Validates one optional string QC request field.
 *
 * @param value - Untrusted field value.
 * @param field - Searchable field name for validation errors.
 * @returns The validated string, or undefined when absent.
 */
function validateOptionalQCString(
    value: unknown,
    field: string,
): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(
            `Invalid QC request: ${field} must be a non-empty string`,
        );
    }
    return value;
}

/**
 * Validates one optional boolean QC request field.
 *
 * @param value - Untrusted field value.
 * @param field - Searchable field name for validation errors.
 * @returns The validated boolean, or undefined when absent.
 */
function validateOptionalQCBoolean(
    value: unknown,
    field: string,
): boolean | undefined {
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`Invalid QC request: ${field} must be a boolean`);
    }
    return value as boolean | undefined;
}

/**
 * Validates an untrusted QC generation IPC payload.
 *
 * @param value - The untrusted IPC payload.
 * @returns A canonical QC configuration without unknown renderer properties.
 */
export function validateQCRequest(value: unknown): QCConfig {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Invalid QC request: expected an object");
    }
    const request = value as Record<string, unknown>;

    if (typeof request.bamPath !== "string" || request.bamPath.length === 0) {
        throw new Error(
            "Invalid QC request: bamPath must be a non-empty string",
        );
    }
    const tag = validateOptionalQCString(request.tag, "tag");
    if (
        request.modStrand !== undefined &&
        request.modStrand !== "bc" &&
        request.modStrand !== "bc_comp"
    ) {
        throw new Error("Invalid QC request: modStrand is invalid");
    }
    const region = validateOptionalQCString(request.region, "region");
    const modRegion = validateOptionalQCString(request.modRegion, "modRegion");
    const fullRegion = validateOptionalQCBoolean(
        request.fullRegion,
        "fullRegion",
    );
    if (region === undefined && fullRegion !== undefined) {
        throw new Error("Invalid QC request: fullRegion requires region");
    }
    if (region === undefined && modRegion !== undefined) {
        throw new Error("Invalid QC request: modRegion requires region");
    }

    const rejectRange = request.rejectModQualNonInclusive;
    let rejectModQualNonInclusive: [number, number] | undefined;
    if (rejectRange !== undefined) {
        if (!Array.isArray(rejectRange) || rejectRange.length !== 2) {
            throw new Error(
                "Invalid QC request: rejectModQualNonInclusive must be a 2-element array",
            );
        }
        const low = validateQCNumber(rejectRange[0], "rejectModQualLow", {
            min: 0,
            max: 255,
            integer: true,
        });
        const high = validateQCNumber(rejectRange[1], "rejectModQualHigh", {
            min: 0,
            max: 255,
            integer: true,
        });
        if (low >= high) {
            throw new Error(
                "Invalid QC request: rejectModQualLow must be less than rejectModQualHigh",
            );
        }
        rejectModQualNonInclusive = [low, high];
    }

    return {
        bamPath: request.bamPath,
        tag,
        modStrand: request.modStrand as "bc" | "bc_comp" | undefined,
        region,
        modRegion,
        fullRegion,
        sampleFraction: validateQCNumber(
            request.sampleFraction,
            "sampleFraction",
            { min: 0.01, max: 100 },
        ),
        sampleSeed: validateQCNumber(request.sampleSeed, "sampleSeed", {
            min: 0,
            max: 4_294_967_295,
            integer: true,
        }),
        windowSize: validateQCNumber(request.windowSize, "windowSize", {
            min: 2,
            max: 10_000,
            integer: true,
        }),
        readLengthBinWidth: validateQCNumber(
            request.readLengthBinWidth,
            "readLengthBinWidth",
            { min: 1, integer: true },
        ),
        mapqFilter: validateOptionalQCNumber(request.mapqFilter, "mapqFilter", {
            min: 0,
            max: 255,
            integer: true,
        }),
        excludeMapqUnavail: validateOptionalQCBoolean(
            request.excludeMapqUnavail,
            "excludeMapqUnavail",
        ),
        readFilter: validateOptionalQCString(request.readFilter, "readFilter"),
        minSeqLen: validateOptionalQCNumber(request.minSeqLen, "minSeqLen", {
            min: 0,
            integer: true,
        }),
        minAlignLen: validateOptionalQCNumber(
            request.minAlignLen,
            "minAlignLen",
            { min: 0, integer: true },
        ),
        readIdFilePath: validateOptionalQCString(
            request.readIdFilePath,
            "readIdFilePath",
        ),
        baseQualFilterMod: validateOptionalQCNumber(
            request.baseQualFilterMod,
            "baseQualFilterMod",
            { min: 0, max: 93, integer: true },
        ),
        trimReadEndsMod: validateOptionalQCNumber(
            request.trimReadEndsMod,
            "trimReadEndsMod",
            { min: 0, integer: true },
        ),
        rejectModQualNonInclusive,
    };
}
