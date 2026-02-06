// Data loader using nanalogue-node for nanalogue-swipe

import { bamMods, peek, windowReads } from "@nanalogue/node";
import type {
    BedAnnotation,
    PlotData,
    PlotDataPoint,
    WindowedPoint,
    WindowReadRow,
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
 * @param bamPath - The filesystem path to the BAM file.
 * @returns A promise that resolves to a mapping of contig names to sizes.
 */
export async function loadContigSizes(bamPath: string): Promise<ContigSizes> {
    const result = await peek({ bamPath });
    return result.contigs;
}

/**
 * Parses a TSV string of windowed read data into structured row objects.
 *
 * @param tsv - The raw TSV string output from the windowReads command.
 * @returns An array of parsed window read rows, skipping the header and incomplete lines.
 */
export function parseWindowReadsTsv(tsv: string): WindowReadRow[] {
    const lines = tsv.trim().split("\n");
    if (lines.length < 2) {
        return [];
    }

    const rows: WindowReadRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const fields = line.split("\t");
        if (fields.length < 12) continue;

        const ref_win_start = parseInt(fields[1], 10);
        const ref_win_end = parseInt(fields[2], 10);
        const win_val = parseFloat(fields[4]);

        if (ref_win_start === -1 || ref_win_end === -1) {
            continue;
        }

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
            contig: fields[0],
            ref_win_start,
            ref_win_end,
            read_id: fields[3],
            win_val,
            strand: fields[5],
            base: fields[6],
            mod_strand: fields[7],
            mod_type: fields[8],
            win_start: parseInt(fields[9], 10),
            win_end: parseInt(fields[10], 10),
            basecall_qual: parseInt(fields[11], 10),
        });
    }

    return rows;
}

/**
 * Loads windowed and raw modification plot data for a given annotation region from a BAM file.
 *
 * @param bamPath - The filesystem path to the BAM file.
 * @param annotation - The BED annotation defining the region and read to query.
 * @param contigSizes - A mapping of contig names to their sizes for bounds checking.
 * @param windowSize - The window size in base pairs for aggregating modification data.
 * @returns A promise that resolves to the plot data containing raw and windowed points.
 */
export async function loadPlotData(
    bamPath: string,
    annotation: BedAnnotation,
    contigSizes: ContigSizes,
    windowSize: number,
): Promise<PlotData> {
    const contigSize = contigSizes[annotation.contig];

    if (contigSize === undefined) {
        throw new Error(`Contig ${annotation.contig} not found in BAM file`);
    }

    let clampWarning: string | undefined;
    if (annotation.end > contigSize) {
        clampWarning = `Annotation end (${annotation.end.toLocaleString()}) clamped to contig length (${contigSize.toLocaleString()})`;
    }

    const expandedStart = Math.max(0, annotation.start - REGION_EXPANSION);
    const expandedEnd = Math.min(contigSize, annotation.end + REGION_EXPANSION);

    if (expandedStart >= expandedEnd) {
        throw new Error(
            `Annotation ${annotation.readId} on ${annotation.contig}:${annotation.start}-${annotation.end} is outside contig bounds (size: ${contigSize})`,
        );
    }

    const region = `${annotation.contig}:${expandedStart}-${expandedEnd}`;
    const modRegion = region;

    const [tsv, modRecords] = await Promise.all([
        windowReads({
            bamPath,
            region,
            modRegion,
            readIdSet: [annotation.readId],
            win: windowSize,
            step: windowSize,
        }),
        bamMods({
            bamPath,
            region,
            modRegion,
            readIdSet: [annotation.readId],
        }),
    ]);

    const rows = parseWindowReadsTsv(tsv);

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
