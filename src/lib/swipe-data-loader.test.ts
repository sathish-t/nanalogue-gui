// Unit tests for swipe-data-loader utilities

import { describe, expect, it } from "vitest";
import { parseWindowReadsJson } from "./swipe-data-loader";
import type { WindowReadsRecord } from "./types";

/**
 * Builds a JSON string from an array of WindowReadsRecord objects.
 *
 * @param records - The records to serialize.
 * @returns The JSON string.
 */
function makeJson(records: WindowReadsRecord[]): string {
    return JSON.stringify(records);
}

describe("parseWindowReadsJson", () => {
    it("parses valid rows", () => {
        const json = makeJson([
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
        const rows = parseWindowReadsJson(json);
        expect(rows).toHaveLength(1);
        expect(rows[0].ref_win_start).toBe(100);
        expect(rows[0].ref_win_end).toBe(200);
        expect(rows[0].win_val).toBe(0.5);
        expect(rows[0].contig).toBe("chr1");
        expect(rows[0].read_id).toBe("read1");
        expect(rows[0].strand).toBe("+");
        expect(rows[0].base).toBe("C");
        expect(rows[0].mod_strand).toBe("+");
        expect(rows[0].mod_type).toBe("m");
        expect(rows[0].win_start).toBe(10);
        expect(rows[0].win_end).toBe(20);
        expect(rows[0].basecall_qual).toBe(30);
    });

    it("drops rows where ref_win_start >= ref_win_end (zero-width)", () => {
        const json = makeJson([
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [
                            [10, 20, 0.5, 30, 200, 200],
                            [10, 20, 0.75, 30, 100, 200],
                        ],
                    },
                ],
                read_id: "read1",
                seq_len: 10,
            },
        ]);
        const rows = parseWindowReadsJson(json);
        expect(rows).toHaveLength(1);
        expect(rows[0].ref_win_start).toBe(100);
    });

    it("drops rows where ref_win_start > ref_win_end (negative-width)", () => {
        const json = makeJson([
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [
                            [10, 20, 0.5, 30, 300, 100],
                            [10, 20, 0.75, 30, 100, 200],
                        ],
                    },
                ],
                read_id: "read2",
                seq_len: 10,
            },
        ]);
        const rows = parseWindowReadsJson(json);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("drops rows where ref_win_start is negative", () => {
        const json = makeJson([
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [
                            [10, 20, 0.5, 30, -5, 100],
                            [10, 20, 0.75, 30, 100, 200],
                        ],
                    },
                ],
                read_id: "read2",
                seq_len: 10,
            },
        ]);
        const rows = parseWindowReadsJson(json);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("skips unmapped reads entirely", () => {
        const json = makeJson([
            {
                alignment_type: "unmapped",
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
            {
                alignment_type: "primary_forward",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: true,
                        mod_code: "m",
                        data: [[10, 20, 0.75, 30, 100, 200]],
                    },
                ],
                read_id: "read2",
                seq_len: 10,
            },
        ]);
        const rows = parseWindowReadsJson(json);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("derives strand from alignment_type", () => {
        const json = makeJson([
            {
                alignment_type: "primary_reverse",
                alignment: { start: 0, end: 10, contig: "chr1", contig_id: 0 },
                mod_table: [
                    {
                        base: "C",
                        is_strand_plus: false,
                        mod_code: "m",
                        data: [[10, 20, 0.5, 30, 100, 200]],
                    },
                ],
                read_id: "read1",
                seq_len: 10,
            },
        ]);
        const rows = parseWindowReadsJson(json);
        expect(rows[0].strand).toBe("-");
        expect(rows[0].mod_strand).toBe("-");
    });

    it("returns empty array for empty JSON array", () => {
        const rows = parseWindowReadsJson("[]");
        expect(rows).toEqual([]);
    });

    it("returns empty array for empty input", () => {
        const rows = parseWindowReadsJson("");
        expect(rows).toEqual([]);
    });
});
