// Swipe data loader using nanalogue-node

import { bamMods, peek, windowReads } from "@nanalogue/node";
import type {
    BedAnnotation,
    PlotData,
    PlotDataPoint,
    WindowedPoint,
    WindowReadRow,
    WindowReadsRecord,
} from "./types";

const REGION_EXPANSION = 10000;

/**
 * Maps contig names to their sizes in base pairs.
 */
export interface ContigSizes {
    /** The size of each contig in base pairs, keyed by contig name. */
    [contig: string]: number;
}

/**
 * Loads contig names and their sizes from a BAM file header.
 *
 * @param bamPath - The filesystem path or URL to the BAM file.
 * @param treatAsUrl - Whether to treat the BAM path as a remote URL.
 * @returns A promise that resolves to a mapping of contig names to sizes.
 */
export async function loadContigSizes(
    bamPath: string,
    treatAsUrl?: boolean,
): Promise<ContigSizes> {
    const result = await peek({ bamPath, treatAsUrl });
    return result.contigs;
}

/**
 * Derives the alignment strand from an alignment_type string.
 *
 * @param alignmentType - The alignment type (e.g. "primary_forward", "primary_reverse").
 * @returns "+" for forward alignments, "-" for reverse alignments.
 */
function strandFromAlignmentType(alignmentType: string): string {
    return alignmentType.endsWith("_reverse") ? "-" : "+";
}

/**
 * Parses a JSON string of windowed read data into structured row objects.
 *
 * @param json - The raw JSON string output from the windowReads command.
 * @returns An array of parsed window read rows, skipping unmapped reads and invalid bounds.
 */
export function parseWindowReadsJson(json: string): WindowReadRow[] {
    const trimmed = json.trim();
    if (trimmed.length === 0) return [];

    const records = JSON.parse(trimmed) as WindowReadsRecord[];
    const rows: WindowReadRow[] = [];

    for (const record of records) {
        if (record.alignment_type === "unmapped") continue;
        if (!record.alignment) continue;

        const contig = record.alignment.contig;
        const strand = strandFromAlignmentType(record.alignment_type);

        for (const entry of record.mod_table) {
            for (const data of entry.data) {
                const ref_win_start = data[4];
                const ref_win_end = data[5];
                const win_val = data[2];

                if (
                    !Number.isFinite(ref_win_start) ||
                    !Number.isFinite(ref_win_end) ||
                    !Number.isFinite(win_val)
                ) {
                    continue;
                }

                // Drop rows with invalid window bounds (zero-width, negative-width, or negative start)
                if (ref_win_start < 0 || ref_win_start >= ref_win_end) {
                    continue;
                }

                rows.push({
                    contig,
                    ref_win_start,
                    ref_win_end,
                    read_id: record.read_id,
                    win_val,
                    strand,
                    base: entry.base,
                    mod_strand: entry.is_strand_plus ? "+" : "-",
                    mod_type: entry.mod_code,
                    win_start: data[0],
                    win_end: data[1],
                    basecall_qual: data[3],
                });
            }
        }
    }

    return rows;
}

/**
 * Options for filtering and configuring how plot data is loaded.
 */
export interface LoadPlotDataOptions {
    /** The number of base pairs to expand the annotation region by on each side. */
    regionExpansion?: number;
    /** The modification tag code to filter by (e.g. "m", "a", "T"). */
    modTag?: string;
    /** The strand convention for modification calls. */
    modStrand?: "bc" | "bc_comp";
    /** Whether to treat the BAM path as a remote URL. */
    treatAsUrl?: boolean;
}

/**
 * Loads windowed and raw modification plot data for a given annotation region from a BAM file.
 *
 * @param bamPath - The filesystem path to the BAM file.
 * @param annotation - The BED annotation defining the region and read to query.
 * @param contigSizes - A mapping of contig names to their sizes for bounds checking.
 * @param windowSize - The window size in base pairs for aggregating modification data.
 * @param options - Optional filtering and region expansion configuration.
 * @returns A promise that resolves to the plot data containing raw and windowed points.
 */
export async function loadPlotData(
    bamPath: string,
    annotation: BedAnnotation,
    contigSizes: ContigSizes,
    windowSize: number,
    options: LoadPlotDataOptions = {},
): Promise<PlotData> {
    const {
        regionExpansion: rawExpansion = REGION_EXPANSION,
        modTag,
        modStrand,
        treatAsUrl,
    } = options;
    const regionExpansion = Number.isFinite(rawExpansion)
        ? Math.max(0, Math.floor(rawExpansion))
        : REGION_EXPANSION;

    const contigSize = contigSizes[annotation.contig];

    if (contigSize === undefined) {
        throw new Error(`Contig ${annotation.contig} not found in BAM file`);
    }

    let clampWarning: string | undefined;
    if (annotation.end > contigSize) {
        clampWarning = `Annotation end (${annotation.end.toLocaleString()}) clamped to contig length (${contigSize.toLocaleString()})`;
    }

    const expandedStart = Math.max(0, annotation.start - regionExpansion);
    const expandedEnd = Math.min(contigSize, annotation.end + regionExpansion);

    if (expandedStart >= expandedEnd) {
        throw new Error(
            `Annotation ${annotation.readId} on ${annotation.contig}:${annotation.start}-${annotation.end} is outside contig bounds (size: ${contigSize})`,
        );
    }

    const region = `${annotation.contig}:${annotation.start}-${Math.min(annotation.end, contigSize)}`;
    const modRegion = `${annotation.contig}:${expandedStart}-${expandedEnd}`;

    const [json, modRecords] = await Promise.all([
        windowReads({
            bamPath,
            treatAsUrl,
            region,
            modRegion,
            fullRegion: true,
            readIdSet: [annotation.readId],
            win: windowSize,
            step: windowSize,
            ...(modTag !== undefined && { tag: modTag }),
            ...(modTag !== undefined &&
                modStrand !== undefined && { modStrand }),
        }),
        bamMods({
            bamPath,
            treatAsUrl,
            region,
            modRegion,
            fullRegion: true,
            readIdSet: [annotation.readId],
            ...(modTag !== undefined && { tag: modTag }),
            ...(modTag !== undefined &&
                modStrand !== undefined && { modStrand }),
        }),
    ]);

    const rows = parseWindowReadsJson(json);

    const windowedPoints: WindowedPoint[] = rows.map((row) => ({
        refWinStart: row.ref_win_start,
        refWinEnd: row.ref_win_end,
        winVal: row.win_val,
    }));

    windowedPoints.sort((a, b) => a.refWinStart - b.refWinStart);

    const rawPoints: PlotDataPoint[] = [];
    for (const record of modRecords) {
        if (record.alignment_type === "unmapped") continue;
        if (!record.mod_table) continue;
        for (const entry of record.mod_table) {
            for (const [, refPos, probability] of entry.data) {
                if (refPos === -1) continue;
                if (refPos >= expandedStart && refPos <= expandedEnd) {
                    rawPoints.push({
                        x: refPos,
                        y: probability / 255,
                    });
                }
            }
        }
    }

    rawPoints.sort((a, b) => a.x - b.x);

    return {
        rawPoints,
        windowedPoints,
        annotation,
        expandedRegion: {
            contig: annotation.contig,
            start: expandedStart,
            end: expandedEnd,
        },
        clampWarning,
    };
}
