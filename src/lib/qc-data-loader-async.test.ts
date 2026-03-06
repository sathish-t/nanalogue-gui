// Unit tests for the async functions in qc-data-loader that call @nanalogue/node.
// Covers peekBam and generateQCData (which exercises paginateBamMods,
// paginateWindowReads, and fetchSeqTable).

import type { BamModRecord } from "@nanalogue/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QCConfig } from "./types";

// ---------------------------------------------------------------------------
// Mock @nanalogue/node — all BAM I/O replaced with controllable fakes.
// ---------------------------------------------------------------------------

vi.mock("@nanalogue/node", () => ({
    peek: vi.fn(),
    bamMods: vi.fn(),
    windowReads: vi.fn(),
    seqTable: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Top-level dynamic imports (after mocks are hoisted).
// ---------------------------------------------------------------------------

const { peek, bamMods, windowReads, seqTable } = await import(
    "@nanalogue/node"
);
const { peekBam, generateQCData } = await import("./qc-data-loader");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid QCConfig for most tests (no region, no tag). */
const BASE_CONFIG: QCConfig = {
    bamPath: "/data/sample.bam",
    treatAsUrl: false,
    sampleFraction: 5,
    sampleSeed: 42,
    windowSize: 300,
    readLengthBinWidth: 100,
    fullRegion: undefined,
};

/**
 * Builds a valid WindowReadsRecord JSON string containing the given number
 * of primary_forward mapped reads, each with one windowed density entry.
 *
 * @param count - The number of records to include.
 * @param winVal - The windowed density value to use.
 * @returns A JSON string suitable for windowReads mock return value.
 */
function makeWindowJson(count: number, winVal = 0.5): string {
    const records = Array.from({ length: count }, (_, i) => ({
        alignment_type: "primary_forward",
        alignment: { start: 0, end: 1000, contig: "chr1", contig_id: 0 },
        mod_table: [
            {
                base: "C",
                is_strand_plus: true,
                mod_code: "m",
                data: [[0, 300, winVal, 30, 0, 300]],
            },
        ],
        read_id: `read${i}`,
        seq_len: 1000,
    }));
    return JSON.stringify(records);
}

/**
 * Builds a BamModRecord array with mapped records that each have one modification.
 *
 * @param count - The number of records to return.
 * @param prob - The raw probability (0-255) to assign each modification call.
 * @returns An array of mock BamModRecord objects.
 */
function makeBamModRecords(count: number, prob = 128): BamModRecord[] {
    return Array.from({ length: count }, (_, i) => ({
        alignment_type: "primary_forward" as const,
        alignment: { start: 0, end: 1000, contig: "chr1", contig_id: 0 },
        mod_table: [
            {
                base: "C",
                is_strand_plus: true,
                mod_code: "m",
                data: [[0, 0, prob]],
            },
        ],
        read_id: `read${i}`,
        seq_len: 1000,
    }));
}

// ---------------------------------------------------------------------------
// Tests for peekBam
// ---------------------------------------------------------------------------

describe("peekBam", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("formats contigs and modifications from peek result", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000, chr2: 10000, chr3: 8000 },
            modifications: [
                ["C", "+", "m"],
                ["A", "+", "a"],
            ],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.contigs).toEqual(["chr1", "chr2", "chr3"]);
        expect(result.totalContigs).toBe(3);
        expect(result.modifications).toEqual(["+m", "+a"]);
        expect(result.allContigs).toEqual({
            chr1: 5000,
            chr2: 10000,
            chr3: 8000,
        });
    });

    it("limits example contigs to three when the BAM has more", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { a: 1, b: 2, c: 3, d: 4, e: 5 },
            modifications: [],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.contigs).toHaveLength(3);
        expect(result.totalContigs).toBe(5);
    });

    it("deduplicates modifications with the same strand and code", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [
                ["C", "+", "m"],
                ["C", "+", "m"],
                ["A", "-", "a"],
            ],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.modifications).toEqual(["+m", "-a"]);
    });

    it("formats negative-strand modifications with a - prefix", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [["C", "-", "m"]],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.modifications).toEqual(["-m"]);
    });

    it("passes bamPath and treatAsUrl through to peek", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [],
        });

        await peekBam("http://example.com/file.bam", true);

        expect(peek).toHaveBeenCalledWith({
            bamPath: "http://example.com/file.bam",
            treatAsUrl: true,
        });
    });

    it("returns empty modification list when BAM has no mods", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: { chr1: 5000 },
            modifications: [],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.modifications).toEqual([]);
    });

    it("returns zero totalContigs for an empty BAM", async () => {
        vi.mocked(peek).mockResolvedValue({
            contigs: {},
            modifications: [],
        });

        const result = await peekBam("/data/sample.bam", false);

        expect(result.contigs).toEqual([]);
        expect(result.totalContigs).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests for generateQCData (exercises paginateBamMods, paginateWindowReads,
// fetchSeqTable via the private helpers).
// ---------------------------------------------------------------------------

describe("generateQCData", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("returns empty histograms when both BAM and windowReads have no records", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData(BASE_CONFIG);

        expect(result.readLengthStats.count).toBe(0);
        expect(result.wholeReadDensityStats.count).toBe(0);
        expect(result.windowedDensityStats.count).toBe(0);
        expect(result.rawProbabilityStats.count).toBe(0);
        expect(result.seqTableSkipReason).toBe("no region selected");
        expect(result.seqTableRows).toBeUndefined();
    });

    it("accumulates rawProbability and wholeReadDensity from bamMods records", async () => {
        vi.mocked(bamMods).mockResolvedValue(makeBamModRecords(3, 128));
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData(BASE_CONFIG);

        // 3 records × 1 probability call each → 3 raw probability counts
        expect(result.rawProbabilityStats.count).toBe(3);
        // Each record contributes one whole-read density entry
        expect(result.wholeReadDensityStats.count).toBe(3);
    });

    it("accumulates read lengths and windowed density from windowReads records", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue(makeWindowJson(2, 0.6));

        const result = await generateQCData(BASE_CONFIG);

        // 2 mapped reads → 2 length entries
        expect(result.readLengthStats.count).toBe(2);
        // 2 windowed density entries
        expect(result.windowedDensityStats.count).toBe(2);
    });

    it("counts alignment types in readTypeCounts", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        const records = [
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 500, contig: "chr1", contig_id: 0 },
                mod_table: [],
                read_id: "r1",
                seq_len: 500,
            },
            {
                alignment_type: "primary_reverse",
                alignment: { start: 0, end: 500, contig: "chr1", contig_id: 0 },
                mod_table: [],
                read_id: "r2",
                seq_len: 500,
            },
            {
                alignment_type: "unmapped",
                mod_table: [],
                read_id: "r3",
                seq_len: 300,
            },
        ];
        vi.mocked(windowReads).mockResolvedValue(JSON.stringify(records));

        const result = await generateQCData(BASE_CONFIG);

        expect(result.readTypeCounts.primaryForward).toBe(1);
        expect(result.readTypeCounts.primaryReverse).toBe(1);
        expect(result.readTypeCounts.unmapped).toBe(1);
    });

    it("skips unmapped bamMods records entirely", async () => {
        const records: BamModRecord[] = [
            {
                alignment_type: "unmapped",
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [[0, 0, 200]],
                    },
                ],
                read_id: "r1",
                seq_len: 500,
            },
        ];
        vi.mocked(bamMods).mockResolvedValue(records);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData(BASE_CONFIG);

        // Unmapped record should be skipped — no probability counts
        expect(result.rawProbabilityStats.count).toBe(0);
    });

    it("logs a warning and skips records missing a mod_table", async () => {
        // Cast to bypass TypeScript — runtime data may lack mod_table
        const records = [
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 500, contig: "chr1", contig_id: 0 },
                mod_table: undefined,
                read_id: "r1",
                seq_len: 500,
            },
        ] as unknown as BamModRecord[];
        vi.mocked(bamMods).mockResolvedValue(records);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData(BASE_CONFIG);

        expect(result.rawProbabilityStats.count).toBe(0);
        expect(console.warn).toHaveBeenCalled();
    });

    it("sets seqTableSkipReason when no region is configured", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData({
            ...BASE_CONFIG,
            region: undefined,
        });

        expect(result.seqTableSkipReason).toBe("no region selected");
        expect(seqTable).not.toHaveBeenCalled();
    });

    it("sets seqTableSkipReason when region is a bare contig name (no range)", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData({
            ...BASE_CONFIG,
            region: "chr1",
            fullRegion: false,
        });

        expect(result.seqTableSkipReason).toBe("no region selected");
        expect(seqTable).not.toHaveBeenCalled();
    });

    it("sets seqTableSkipReason when region exceeds 500 bp", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        // 1000 bp region → too large for seqTable
        const result = await generateQCData({
            ...BASE_CONFIG,
            region: "chr1:0-1000",
            fullRegion: false,
        });

        expect(result.seqTableSkipReason).toBe("region > 500 bp");
        expect(seqTable).not.toHaveBeenCalled();
    });

    it("calls seqTable twice and returns rows when region is within the 500 bp limit", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        // Both tagged and base calls return the same single-row TSV
        const tsv = "read_id\tsequence\tqualities\nread1\tACGT\t10.20.30.40\n";
        vi.mocked(seqTable).mockResolvedValue(tsv);

        const result = await generateQCData({
            ...BASE_CONFIG,
            region: "chr1:0-400",
            fullRegion: false,
        });

        // seqTable should have been called twice (tagged + base)
        expect(seqTable).toHaveBeenCalledTimes(2);
        expect(result.seqTableRows).toBeDefined();
        expect(result.seqTableSkipReason).toBeUndefined();
    });

    it("calls onProgress with modification and window counts", async () => {
        vi.mocked(bamMods).mockResolvedValue(makeBamModRecords(1));
        vi.mocked(windowReads).mockResolvedValue(makeWindowJson(1));

        const onProgress = vi.fn();
        await generateQCData(BASE_CONFIG, onProgress);

        // onProgress should have been called at least once for modifications
        // and at least once for windows
        const sources = onProgress.mock.calls.map((c) => c[0] as string);
        expect(sources).toContain("modifications");
        expect(sources).toContain("windows");
    });

    it("paginates bamMods when first page is full", async () => {
        // First call returns a full page (1000 records), second returns empty
        vi.mocked(bamMods)
            .mockResolvedValueOnce(makeBamModRecords(1000))
            .mockResolvedValueOnce([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData(BASE_CONFIG);

        // bamMods called twice (page 0 full → fetch page 1 → empty → stop)
        expect(bamMods).toHaveBeenCalledTimes(2);
        expect(result.rawProbabilityStats.count).toBe(1000);
    });

    it("paginates windowReads when first page is full", async () => {
        const fullPage = makeWindowJson(10_000);
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads)
            .mockResolvedValueOnce(fullPage)
            .mockResolvedValueOnce("[]");

        await generateQCData(BASE_CONFIG);

        // windowReads called twice (full page → fetch again → empty → stop)
        expect(windowReads).toHaveBeenCalledTimes(2);
    });

    it("stores sampleSeed in the returned data", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData({ ...BASE_CONFIG, sampleSeed: 99 });

        expect(result.sampleSeed).toBe(99);
    });

    it("records readLengthBinWidth in the result", async () => {
        vi.mocked(bamMods).mockResolvedValue([]);
        vi.mocked(windowReads).mockResolvedValue("[]");

        const result = await generateQCData({
            ...BASE_CONFIG,
            readLengthBinWidth: 500,
        });

        expect(result.readLengthBinWidth).toBe(500);
    });
});
