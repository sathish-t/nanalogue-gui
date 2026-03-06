// Unit tests for the async functions in swipe-data-loader that call @nanalogue/node.
// Covers loadContigSizes and loadPlotData.

import type { BamModRecord } from "@nanalogue/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BedAnnotation } from "./types";

// ---------------------------------------------------------------------------
// Mock @nanalogue/node — all BAM I/O replaced with controllable fakes.
// ---------------------------------------------------------------------------

vi.mock("@nanalogue/node", () => ({
    peek: vi.fn(),
    bamMods: vi.fn(),
    windowReads: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Top-level dynamic imports (after mocks are hoisted).
// ---------------------------------------------------------------------------

const { peek, bamMods, windowReads } = await import("@nanalogue/node");
const { loadContigSizes, loadPlotData } = await import("./swipe-data-loader");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple annotation on chr1 used as a base for most tests. */
const BASE_ANNOTATION: BedAnnotation = {
    contig: "chr1",
    start: 1000,
    end: 2000,
    readId: "read-abc",
    rawLine: "chr1\t1000\t2000\tread-abc",
};

/** Contig sizes map with chr1 = 50 000 bp. */
const CONTIG_SIZES = { chr1: 50_000 };

/**
 * Builds a JSON string of one windowed read record for a given contig region.
 * Used as the windowReads mock return value in loadPlotData tests.
 *
 * @param refWinStart - The ref_win_start of the data entry.
 * @param refWinEnd - The ref_win_end of the data entry.
 * @param winVal - The windowed density value.
 * @returns A JSON string suitable for the windowReads mock.
 */
function makeWindowJson(
    refWinStart: number,
    refWinEnd: number,
    winVal: number,
): string {
    const record = {
        alignment_type: "primary_forward",
        alignment: {
            start: BASE_ANNOTATION.start,
            end: BASE_ANNOTATION.end,
            contig: "chr1",
            contig_id: 0,
        },
        mod_table: [
            {
                base: "C",
                is_strand_plus: true,
                mod_code: "m",
                data: [[0, 100, winVal, 30, refWinStart, refWinEnd]],
            },
        ],
        read_id: BASE_ANNOTATION.readId,
        seq_len: 1000,
    };
    return JSON.stringify([record]);
}

/**
 * Builds an array of BamModRecord objects with one modification entry.
 * Used as the bamMods mock return value in loadPlotData tests.
 *
 * @param refPos - The reference position of the modification.
 * @param prob - The raw probability (0-255).
 * @returns An array containing one mapped BamModRecord.
 */
function makeBamModRecords(refPos: number, prob = 200): BamModRecord[] {
    return [
        {
            alignment_type: "primary_forward" as const,
            alignment: {
                start: BASE_ANNOTATION.start,
                end: BASE_ANNOTATION.end,
                contig: "chr1",
                contig_id: 0,
            },
            mod_table: [
                {
                    base: "C",
                    is_strand_plus: true,
                    mod_code: "m",
                    data: [[0, refPos, prob]],
                },
            ],
            read_id: BASE_ANNOTATION.readId,
            seq_len: 1000,
        },
    ];
}

// ---------------------------------------------------------------------------
// Tests for loadContigSizes
// ---------------------------------------------------------------------------

describe("loadContigSizes", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("returns contigs from peek result", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000, chr2: 10000 },
            modifications: [],
        });

        const result = await loadContigSizes("/data/sample.bam");

        expect(result).toEqual({ chr1: 5000, chr2: 10000 });
    });

    it("passes bamPath and treatAsUrl to peek", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [],
        });

        await loadContigSizes("http://example.com/file.bam", true);

        expect(peek).toHaveBeenCalledWith({
            bamPath: "http://example.com/file.bam",
            treatAsUrl: true,
        });
    });

    it("returns an empty object when the BAM has no contigs", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: {},
            modifications: [],
        });

        const result = await loadContigSizes("/data/empty.bam");

        expect(result).toEqual({});
    });

    it("treats undefined treatAsUrl as falsy (no explicit true)", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [],
        });

        await loadContigSizes("/data/sample.bam");

        const callArg = vi.mocked(peek).mock.calls[0][0];
        expect(callArg.treatAsUrl).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tests for loadPlotData
// ---------------------------------------------------------------------------

describe("loadPlotData", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("returns windowedPoints and rawPoints for a valid annotation", async () => {
        vi.mocked(windowReads).mockResolvedValue(
            makeWindowJson(1000, 2000, 0.7),
        );
        vi.mocked(bamMods).mockResolvedValue(makeBamModRecords(1500, 200));

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        expect(result.windowedPoints).toHaveLength(1);
        expect(result.windowedPoints[0].winVal).toBeCloseTo(0.7);
        expect(result.rawPoints).toHaveLength(1);
        // Probability normalised from 200/255
        expect(result.rawPoints[0].y).toBeCloseTo(200 / 255);
    });

    it("throws when the annotation contig is not in contigSizes", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        await expect(
            loadPlotData("/data/sample.bam", BASE_ANNOTATION, {}, 300),
        ).rejects.toThrow(/chr1 not found/i);
    });

    it("sets clampWarning when annotation end exceeds contig length", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        // Annotation end (2000) > contig size (1500) → clamp warning
        const result = await loadPlotData(
            "/data/sample.bam",
            { ...BASE_ANNOTATION, end: 2000 },
            { chr1: 1500 },
            300,
        );

        expect(result.clampWarning).toMatch(/clamped/i);
    });

    it("throws when the annotation is entirely outside contig bounds", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        // start=1000, end=2000, contigSize=500 → expandedEnd=500 > expandedStart after clamping
        // But more directly: annotation.start(1000) - expansion(10000) = max(0,0) = 0,
        // annotation.end(2000) + expansion(10000) = min(500,12000) = 500
        // 0 < 500 so actually won't throw here; use a zero-size contig to force it.
        await expect(
            loadPlotData(
                "/data/sample.bam",
                { ...BASE_ANNOTATION, start: 1000, end: 2000 },
                { chr1: 0 },
                300,
            ),
        ).rejects.toThrow(/outside contig bounds/i);
    });

    it("sorts windowedPoints by refWinStart", async () => {
        // Two records returned in reverse order
        const records = [
            {
                alignment_type: "primary_forward",
                alignment: {
                    start: 1000,
                    end: 2000,
                    contig: "chr1",
                    contig_id: 0,
                },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [
                            [0, 300, 0.8, 30, 2000, 3000],
                            [0, 300, 0.5, 30, 1000, 2000],
                        ],
                    },
                ],
                read_id: BASE_ANNOTATION.readId,
                seq_len: 2000,
            },
        ];
        vi.mocked(windowReads).mockResolvedValue(JSON.stringify(records));
        vi.mocked(bamMods).mockResolvedValue([]);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            1000,
        );

        expect(result.windowedPoints[0].refWinStart).toBe(1000);
        expect(result.windowedPoints[1].refWinStart).toBe(2000);
    });

    it("sorts rawPoints by x position", async () => {
        const modRecords: BamModRecord[] = [
            {
                alignment_type: "primary_forward" as const,
                alignment: {
                    start: 1000,
                    end: 2000,
                    contig: "chr1",
                    contig_id: 0,
                },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        // Two mod calls in reverse reference order
                        data: [
                            [0, 1800, 200],
                            [0, 1200, 100],
                        ],
                    },
                ],
                read_id: BASE_ANNOTATION.readId,
                seq_len: 1000,
            },
        ];
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue(modRecords);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        expect(result.rawPoints[0].x).toBeLessThan(result.rawPoints[1].x);
        expect(result.rawPoints[0].x).toBe(1200);
        expect(result.rawPoints[1].x).toBe(1800);
    });

    it("excludes rawPoints where refPos is -1", async () => {
        const modRecords: BamModRecord[] = [
            {
                alignment_type: "primary_forward" as const,
                alignment: {
                    start: 1000,
                    end: 2000,
                    contig: "chr1",
                    contig_id: 0,
                },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [
                            [0, -1, 200], // should be excluded
                            [0, 1500, 128], // should be included
                        ],
                    },
                ],
                read_id: BASE_ANNOTATION.readId,
                seq_len: 1000,
            },
        ];
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue(modRecords);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        expect(result.rawPoints).toHaveLength(1);
        expect(result.rawPoints[0].x).toBe(1500);
    });

    it("skips unmapped bamMods records when building rawPoints", async () => {
        const modRecords: BamModRecord[] = [
            {
                alignment_type: "unmapped" as const,
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [[0, 1500, 200]],
                    },
                ],
                read_id: BASE_ANNOTATION.readId,
                seq_len: 500,
            },
        ];
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue(modRecords);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        expect(result.rawPoints).toHaveLength(0);
    });

    it("includes expandedRegion in the result", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
            { regionExpansion: 500 },
        );

        expect(result.expandedRegion.contig).toBe("chr1");
        // expandedStart = max(0, 1000-500) = 500
        expect(result.expandedRegion.start).toBe(500);
        // expandedEnd = min(50000, 2000+500) = 2500
        expect(result.expandedRegion.end).toBe(2500);
    });

    it("uses default region expansion of 10 000 when not specified", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        // Default expansion is 10 000
        expect(result.expandedRegion.start).toBe(0); // max(0, 1000-10000)
        expect(result.expandedRegion.end).toBe(12_000); // min(50000, 2000+10000)
    });

    it("clamps non-finite regionExpansion to the default", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
            { regionExpansion: Number.NaN },
        );

        // NaN expansion → falls back to default 10 000
        expect(result.expandedRegion.end).toBe(12_000);
    });

    it("includes the annotation in the result", async () => {
        vi.mocked(windowReads).mockResolvedValue("[]");
        vi.mocked(bamMods).mockResolvedValue([]);

        const result = await loadPlotData(
            "/data/sample.bam",
            BASE_ANNOTATION,
            CONTIG_SIZES,
            300,
        );

        expect(result.annotation).toEqual(BASE_ANNOTATION);
    });
});
