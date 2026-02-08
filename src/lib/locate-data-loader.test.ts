// Unit tests for locate-data-loader read ID parsing and BED generation

import type { ReadInfoRecord } from "@nanalogue/node";
import { describe, expect, it } from "vitest";
import { generateBedLines, parseReadIds } from "./locate-data-loader";

describe("parseReadIds", () => {
    it("parses one ID per line", () => {
        const result = parseReadIds("read1\nread2\nread3\n");
        expect(result).toEqual(["read1", "read2", "read3"]);
    });

    it("trims whitespace from lines", () => {
        const result = parseReadIds("  read1  \n\tread2\t\n");
        expect(result).toEqual(["read1", "read2"]);
    });

    it("filters out empty lines", () => {
        const result = parseReadIds("read1\n\n\nread2\n\n");
        expect(result).toEqual(["read1", "read2"]);
    });

    it("returns empty array for empty input", () => {
        expect(parseReadIds("")).toEqual([]);
    });

    it("returns empty array for whitespace-only input", () => {
        expect(parseReadIds("  \n  \n  ")).toEqual([]);
    });

    it("handles input without trailing newline", () => {
        const result = parseReadIds("read1\nread2");
        expect(result).toEqual(["read1", "read2"]);
    });

    it("handles Windows line endings", () => {
        const result = parseReadIds("read1\r\nread2\r\n");
        expect(result).toEqual(["read1", "read2"]);
    });

    it("deduplicates repeated read IDs", () => {
        const result = parseReadIds("read1\nread2\nread1\nread3\nread2\n");
        expect(result).toEqual(["read1", "read2", "read3"]);
    });
});

describe("generateBedLines", () => {
    it("produces BED lines for mapped forward reads", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "primary_forward",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 1);
        expect(result.lines).toEqual(["chr1\t100\t600\tr1\t1000\t+"]);
        expect(result.summary.bedEntries).toBe(1);
        expect(result.summary.unmapped).toBe(0);
    });

    it("produces minus strand for reverse reads", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "primary_reverse",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 1);
        expect(result.lines).toEqual(["chr1\t100\t600\tr1\t1000\t-"]);
    });

    it("handles secondary and supplementary alignments", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "secondary_forward",
                mod_count: "",
            },
            {
                read_id: "r2",
                sequence_length: 500,
                contig: "chr2",
                reference_start: 200,
                reference_end: 700,
                alignment_length: 500,
                alignment_type: "supplementary_reverse",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 2);
        expect(result.lines[0]).toContain("+");
        expect(result.lines[1]).toContain("-");
    });

    it("excludes unmapped reads", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                alignment_type: "unmapped",
                mod_count: "",
            },
            {
                read_id: "r2",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "primary_forward",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 2);
        expect(result.lines).toHaveLength(1);
        expect(result.summary.unmapped).toBe(1);
        expect(result.summary.bedEntries).toBe(1);
    });

    it("computes correct summary counts", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "primary_forward",
                mod_count: "",
            },
            {
                read_id: "r2",
                sequence_length: 500,
                alignment_type: "unmapped",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 5);
        expect(result.summary).toEqual({
            totalIds: 5,
            found: 2,
            unmapped: 1,
            bedEntries: 1,
            notFound: 3,
        });
    });

    it("returns empty result for no records", () => {
        const result = generateBedLines([], 3);
        expect(result.lines).toEqual([]);
        expect(result.summary).toEqual({
            totalIds: 3,
            found: 0,
            unmapped: 0,
            bedEntries: 0,
            notFound: 3,
        });
    });

    it("counts unique read IDs for found when reads have multiple alignments", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 100,
                reference_end: 600,
                alignment_length: 500,
                alignment_type: "primary_forward",
                mod_count: "",
            },
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr2",
                reference_start: 700,
                reference_end: 900,
                alignment_length: 200,
                alignment_type: "supplementary_forward",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 3);
        expect(result.summary.found).toBe(1);
        expect(result.summary.notFound).toBe(2);
        expect(result.summary.bedEntries).toBe(2);
    });

    it("always uses score of 1000", () => {
        const records: ReadInfoRecord[] = [
            {
                read_id: "r1",
                sequence_length: 500,
                contig: "chr1",
                reference_start: 0,
                reference_end: 500,
                alignment_length: 500,
                alignment_type: "primary_forward",
                mod_count: "",
            },
        ];
        const result = generateBedLines(records, 1);
        const fields = result.lines[0].split("\t");
        expect(fields[4]).toBe("1000");
    });
});
