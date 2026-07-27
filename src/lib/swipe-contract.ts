import { validateIpcRemoteBamUrl } from "./ipc-path-validation";

/** A single annotation row parsed from a BED file. */
export interface BedAnnotation {
    /** Contig or chromosome name. */
    contig: string;
    /** Zero-based annotation start. */
    start: number;
    /** Exclusive annotation end. */
    end: number;
    /** Read identifier associated with the annotation. */
    readId: string;
    /** Original unparsed BED line. */
    rawLine: string;
}

/** State for an annotation-review session. */
export interface SwipeReviewState {
    /** Zero-based index of the current annotation. */
    currentIndex: number;
    /** Total annotations in the review. */
    totalCount: number;
    /** Number of accepted annotations. */
    acceptedCount: number;
    /** Number of rejected annotations. */
    rejectedCount: number;
    /** Destination for accepted annotations. */
    outputPath?: string;
    /** Whether the annotation highlight is displayed. */
    showAnnotationHighlight?: boolean;
}

/** A raw signal point displayed by Swipe. */
export interface SwipePlotDataPoint {
    /** Genomic position in base pairs. */
    x: number;
    /** Modification probability. */
    y: number;
}

/** A windowed signal point displayed by Swipe. */
export interface SwipeWindowedPoint {
    /** Reference-window start position. */
    refWinStart: number;
    /** Reference-window end position. */
    refWinEnd: number;
    /** Aggregated value for the window. */
    winVal: number;
}

/** Plot payload for one Swipe annotation. */
export interface SwipePlotData {
    /** Raw signal points. */
    rawPoints: SwipePlotDataPoint[];
    /** Windowed aggregate points. */
    windowedPoints: SwipeWindowedPoint[];
    /** Annotation represented by this plot. */
    annotation: BedAnnotation;
    /** Expanded genomic viewport around the annotation. */
    expandedRegion: {
        /** Contig containing the viewport. */
        contig: string;
        /** Viewport start position. */
        start: number;
        /** Viewport end position. */
        end: number;
    };
    /** Warning when coordinates were clamped to contig bounds. */
    clampWarning?: string;
}

/** Result of accepting or rejecting the current annotation. */
export type SwipeReviewActionResult =
    | {
          /** Every annotation has been reviewed. */
          done: true;
          /** Final review state. */
          state: SwipeReviewState;
      }
    | {
          /** More annotations remain. */
          done: false;
          /** Updated review state. */
          state: SwipeReviewState;
          /** Next plot, or null when it failed to load. */
          plotData: SwipePlotData | null;
      };

/** Named request used to start a Swipe review. */
export interface SwipeStartRequest {
    /** BAM file path or URL. */
    bamPath: string;
    /** Input BED annotation path. */
    bedPath: string;
    /** Output BED path for accepted annotations. */
    outputPath: string;
    /** Signal aggregation window in base pairs. */
    windowSize: number;
    /** Modification tag to include. */
    modTag?: string;
    /** Modification strand convention. */
    modStrand?: "bc" | "bc_comp";
    /** Base pairs added to each side of the annotation region. */
    regionExpansion?: number;
    /** Whether to display the annotation highlight. */
    showAnnotationHighlight?: boolean;
    /** Whether bamPath is a remote URL. */
    treatAsUrl?: boolean;
}

/** Result returned while launching Swipe. */
export type SwipeLaunchResult =
    | {
          /** The review launched. */
          success: true;
      }
    | {
          /** The review failed to launch. */
          success: false;
          /** User-facing failure details. */
          reason: string;
      };

/**
 * Validates an untrusted Swipe start IPC payload.
 *
 * @param value - The untrusted IPC payload.
 * @returns The validated Swipe start request.
 */
export function validateSwipeStartRequest(value: unknown): SwipeStartRequest {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("Invalid Swipe start request: expected an object");
    const request = value as Record<string, unknown>;
    for (const field of ["bamPath", "bedPath", "outputPath"] as const) {
        if (typeof request[field] !== "string" || request[field].length === 0)
            throw new Error(
                `Invalid Swipe start request: ${field} must be a non-empty string`,
            );
    }
    if (
        !Number.isInteger(request.windowSize) ||
        (request.windowSize as number) < 2 ||
        (request.windowSize as number) > 10_000
    )
        throw new Error(
            "Invalid Swipe start request: windowSize must be an integer between 2 and 10,000",
        );
    if (request.modTag !== undefined && typeof request.modTag !== "string")
        throw new Error("Invalid Swipe start request: modTag must be a string");
    if (
        request.modStrand !== undefined &&
        request.modStrand !== "bc" &&
        request.modStrand !== "bc_comp"
    )
        throw new Error("Invalid Swipe start request: modStrand is invalid");
    if (
        request.regionExpansion !== undefined &&
        (!Number.isInteger(request.regionExpansion) ||
            (request.regionExpansion as number) < 0)
    )
        throw new Error(
            "Invalid Swipe start request: regionExpansion must be a non-negative integer",
        );
    for (const field of ["showAnnotationHighlight", "treatAsUrl"] as const) {
        if (request[field] !== undefined && typeof request[field] !== "boolean")
            throw new Error(
                `Invalid Swipe start request: ${field} must be a boolean`,
            );
    }
    if (request.treatAsUrl === true) {
        validateIpcRemoteBamUrl(request.bamPath as string, "Swipe");
    }
    return {
        bamPath: request.bamPath as string,
        bedPath: request.bedPath as string,
        outputPath: request.outputPath as string,
        windowSize: request.windowSize as number,
        modTag: request.modTag as string | undefined,
        modStrand: request.modStrand as "bc" | "bc_comp" | undefined,
        regionExpansion: request.regionExpansion as number | undefined,
        showAnnotationHighlight: request.showAnnotationHighlight as
            | boolean
            | undefined,
        treatAsUrl: request.treatAsUrl as boolean | undefined,
    };
}
