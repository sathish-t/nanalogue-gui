// Unit tests for qc-data-loader utilities

import { describe, expect, it } from "vitest";
import { RunningHistogram } from "./histogram";
import {
    computeAvgQuality,
    matchBaseByLength,
    maxReadLengthForBinWidth,
    parseSeqTableTsv,
    parseWindowReadsJson,
    regionSizeBp,
} from "./qc-data-loader";

describe("parseWindowReadsJson", () => {
    it("returns empty array for empty input", () => {
        expect(parseWindowReadsJson("")).toEqual([]);
    });

    it("returns empty array for whitespace-only input", () => {
        expect(parseWindowReadsJson("   ")).toEqual([]);
    });

    it("parses valid JSON records", () => {
        const json = JSON.stringify([
            {
                alignment_type: "primary_forward",
                alignment: { start: 9, end: 17, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [[10, 20, 0.5, 30, 100, 200]],
                    },
                ],
                read_id: "read1",
                seq_len: 8,
            },
        ]);

        const result = parseWindowReadsJson(json);
        expect(result).toHaveLength(1);
        expect(result[0].alignment_type).toBe("primary_forward");
        expect(result[0].read_id).toBe("read1");
        expect(result[0].mod_table[0].data[0][2]).toBe(0.5);
    });

    it("parses multiple records", () => {
        const json = JSON.stringify([
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [],
                read_id: "read1",
                seq_len: 10,
            },
            {
                alignment_type: "unmapped",
                mod_table: [],
                read_id: "read2",
                seq_len: 5,
            },
        ]);

        const result = parseWindowReadsJson(json);
        expect(result).toHaveLength(2);
        expect(result[0].alignment_type).toBe("primary_forward");
        expect(result[1].alignment_type).toBe("unmapped");
        expect(result[1].alignment).toBeUndefined();
    });

    it("parses empty JSON array", () => {
        expect(parseWindowReadsJson("[]")).toEqual([]);
    });
});

describe("maxReadLengthForBinWidth", () => {
    it("returns 30M for binWidth >= 10000", () => {
        expect(maxReadLengthForBinWidth(10_000)).toBe(30_000_000);
        expect(maxReadLengthForBinWidth(50_000)).toBe(30_000_000);
    });

    it("returns 3M for binWidth >= 1000 and < 10000", () => {
        expect(maxReadLengthForBinWidth(1000)).toBe(3_000_000);
        expect(maxReadLengthForBinWidth(5000)).toBe(3_000_000);
        expect(maxReadLengthForBinWidth(9999)).toBe(3_000_000);
    });

    it("returns 300K for binWidth >= 10 and < 1000", () => {
        expect(maxReadLengthForBinWidth(10)).toBe(300_000);
        expect(maxReadLengthForBinWidth(100)).toBe(300_000);
        expect(maxReadLengthForBinWidth(999)).toBe(300_000);
    });

    it("returns 30K for binWidth < 10", () => {
        expect(maxReadLengthForBinWidth(1)).toBe(30_000);
        expect(maxReadLengthForBinWidth(9)).toBe(30_000);
    });
});

describe("probability normalization", () => {
    it("normalizes raw 0-255 probabilities into 0-1 range", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        const rawValues = [0, 1, 127, 128, 254, 255];

        for (const raw of rawValues) {
            const normalized = Math.min(raw / 255, 1 - Number.EPSILON);
            hist.add(normalized);
        }

        expect(hist.count).toBe(6);
        expect(hist.exceededCount).toBe(0);

        const bins = hist.toBins();
        for (const bin of bins) {
            expect(bin.binStart).toBeGreaterThanOrEqual(0);
            expect(bin.binEnd).toBeLessThanOrEqual(1.0);
        }
    });

    it("maps raw 255 into the last bin [0.99, 1.00]", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        const normalized = Math.min(255 / 255, 1 - Number.EPSILON);
        hist.add(normalized);

        const bins = hist.toBins();
        const lastBin = bins[bins.length - 1];
        expect(lastBin.binStart).toBeCloseTo(0.99, 9);
        expect(lastBin.count).toBe(1);
        expect(hist.exceededCount).toBe(0);
    });

    it("maps raw 0 into the first bin [0, 0.01)", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        hist.add(Math.min(0 / 255, 1 - Number.EPSILON));

        const bins = hist.toBins();
        expect(bins[0].binStart).toBe(0);
        expect(bins[0].count).toBe(1);
    });

    it("produces 100 bins for a full 0-1 range histogram", () => {
        const hist = new RunningHistogram(0.01, 1.0);
        // Add one value in each bin
        for (let raw = 0; raw <= 255; raw++) {
            hist.add(Math.min(raw / 255, 1 - Number.EPSILON));
        }

        const bins = hist.toBins();
        expect(bins.length).toBe(100);
    });
});

describe("parseSeqTableTsv", () => {
    /** Verifies basic TSV parsing of read_id, sequence, and qualities columns. */
    it("parses a simple two-row TSV", () => {
        const tsv = [
            "read_id\tsequence\tqualities",
            "read1\tACGT\t10.20.30.40",
            "read2\tTGCA\t5.255.15.25",
        ].join("\n");

        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(2);
        expect(rows[0].readId).toBe("read1");
        expect(rows[0].sequence).toBe("ACGT");
        expect(rows[0].qualities).toEqual([10, 20, 30, 40]);
        expect(rows[1].readId).toBe("read2");
        expect(rows[1].qualities).toEqual([5, 255, 15, 25]);
    });

    /** Verifies that a header-only TSV returns an empty array. */
    it("returns empty array for header-only TSV", () => {
        const tsv = "read_id\tsequence\tqualities";
        expect(parseSeqTableTsv(tsv)).toEqual([]);
    });

    /** Verifies that an empty string returns an empty array. */
    it("returns empty array for empty string", () => {
        expect(parseSeqTableTsv("")).toEqual([]);
    });

    /** Verifies trailing newlines are handled correctly. */
    it("handles trailing newlines", () => {
        const tsv =
            "read_id\tsequence\tqualities\nread1\tACGT\t10.20.30.40\n\n";
        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(1);
    });

    /** Splits comma-separated sequences into multiple rows sharing the same readId. */
    it("splits comma-separated multi-alignment rows", () => {
        const tsv = [
            "read_id\tsequence\tqualities",
            "read1\tACGT,TG\t10.20.30.40,5.15",
        ].join("\n");

        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            readId: "read1",
            sequence: "ACGT",
            qualities: [10, 20, 30, 40],
        });
        expect(rows[1]).toEqual({
            readId: "read1",
            sequence: "TG",
            qualities: [5, 15],
        });
    });

    /** Handles a mix of single and multi-alignment rows. */
    it("handles mix of single and multi-alignment rows", () => {
        const tsv = [
            "read_id\tsequence\tqualities",
            "read1\tACGT\t10.20.30.40",
            "read2\tAA,GGG\t1.2,3.4.5",
        ].join("\n");

        const rows = parseSeqTableTsv(tsv);
        expect(rows).toHaveLength(3);
        expect(rows[0].readId).toBe("read1");
        expect(rows[1]).toEqual({
            readId: "read2",
            sequence: "AA",
            qualities: [1, 2],
        });
        expect(rows[2]).toEqual({
            readId: "read2",
            sequence: "GGG",
            qualities: [3, 4, 5],
        });
    });
});

describe("matchBaseByLength", () => {
    /** Matches sequences by unique lengths. */
    it("matches by unique lengths", () => {
        const tagged = ["ACGT", "TG"];
        const base = ["XX", "YYYY"];
        const result = matchBaseByLength(tagged, base);
        expect(result).toEqual(["YYYY", "XX"]);
    });

    /** Returns null when two tagged sequences have the same length. */
    it("returns null for ambiguous lengths", () => {
        const tagged = ["ACGT", "TGCA"];
        const base = ["XXXX", "YYYY"];
        expect(matchBaseByLength(tagged, base)).toBeNull();
    });

    /** Handles single-element arrays (trivial match). */
    it("matches single-element arrays", () => {
        const tagged = ["ACGT"];
        const base = ["YYYY"];
        expect(matchBaseByLength(tagged, base)).toEqual(["YYYY"]);
    });

    /** Returns null when a tagged length has no base match. */
    it("returns null when no base matches a tagged length", () => {
        const tagged = ["ACGT", "TG"];
        const base = ["XXX", "YYYYY"];
        expect(matchBaseByLength(tagged, base)).toBeNull();
    });
});

describe("computeAvgQuality", () => {
    /** Verifies probability-based average excluding 255 values. */
    it("computes probability-based average excluding 255 values", () => {
        // [10, 20, 30]: min=10, sum=10^0+10^-1+10^-2=1.11, 10+round(-10*log10(1.11/3))=14
        expect(computeAvgQuality([10, 20, 255, 30])).toBe(14);
    });

    /** Verifies null is returned when all values are 255. */
    it("returns null when all values are 255", () => {
        expect(computeAvgQuality([255, 255, 255])).toBeNull();
    });

    /** Verifies null for empty array. */
    it("returns null for empty array", () => {
        expect(computeAvgQuality([])).toBeNull();
    });

    /** Verifies single non-255 value returns that value unchanged. */
    it("handles single value", () => {
        expect(computeAvgQuality([42])).toBe(42);
    });

    /** Verifies identical values return the same value. */
    it("returns same value when all qualities are equal", () => {
        expect(computeAvgQuality([15, 15, 15])).toBe(15);
    });
});

describe("regionSizeBp", () => {
    /** Returns size for a valid range region. */
    it("returns size for contig:start-end", () => {
        expect(regionSizeBp("chr1:100-600")).toBe(500);
    });

    /** Returns null for bare contig name (no range). */
    it("returns null for bare contig name", () => {
        expect(regionSizeBp("chr1")).toBeNull();
    });

    /** Returns null for undefined. */
    it("returns null for undefined", () => {
        expect(regionSizeBp(undefined)).toBeNull();
    });

    /** Returns size of 1 for a 1-bp region. */
    it("returns 1 for chr1:100-101", () => {
        expect(regionSizeBp("chr1:100-101")).toBe(1);
    });
});
