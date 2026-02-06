// Unit tests for data-loader utilities

import { describe, expect, it } from "vitest";
import { parseWindowReadsTsv } from "./data-loader";

const HEADER =
    "contig\tref_win_start\tref_win_end\tread_id\twin_val\tstrand\tbase\tmod_strand\tmod_type\twin_start\twin_end\tbasecall_qual";

/**
 * Builds a TSV string with the standard window reads header and the given data rows.
 *
 * @param rows - The data rows to append after the header.
 * @returns The complete TSV string.
 */
function makeTsv(rows: string[]): string {
    return [HEADER, ...rows].join("\n");
}

describe("parseWindowReadsTsv", () => {
    it("parses valid rows", () => {
        const tsv = makeTsv([
            "chr1\t100\t200\tread1\t0.5\t+\tC\tbc\tm\t10\t20\t30",
        ]);
        const rows = parseWindowReadsTsv(tsv);
        expect(rows).toHaveLength(1);
        expect(rows[0].ref_win_start).toBe(100);
        expect(rows[0].ref_win_end).toBe(200);
    });

    it("drops rows where ref_win_start >= ref_win_end (zero-width)", () => {
        const tsv = makeTsv([
            "chr1\t200\t200\tread1\t0.5\t+\tC\tbc\tm\t10\t20\t30",
            "chr1\t100\t200\tread2\t0.75\t+\tC\tbc\tm\t10\t20\t30",
        ]);
        const rows = parseWindowReadsTsv(tsv);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("drops rows where ref_win_start > ref_win_end (negative-width)", () => {
        const tsv = makeTsv([
            "chr1\t300\t100\tread1\t0.5\t+\tC\tbc\tm\t10\t20\t30",
            "chr1\t100\t200\tread2\t0.75\t+\tC\tbc\tm\t10\t20\t30",
        ]);
        const rows = parseWindowReadsTsv(tsv);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("drops rows where ref_win_start is negative", () => {
        const tsv = makeTsv([
            "chr1\t-5\t100\tread1\t0.5\t+\tC\tbc\tm\t10\t20\t30",
            "chr1\t100\t200\tread2\t0.75\t+\tC\tbc\tm\t10\t20\t30",
        ]);
        const rows = parseWindowReadsTsv(tsv);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("still drops unmapped rows with -1 values", () => {
        const tsv = makeTsv([
            "chr1\t-1\t-1\tread1\t0.5\t+\tC\tbc\tm\t10\t20\t30",
            "chr1\t100\t200\tread2\t0.75\t+\tC\tbc\tm\t10\t20\t30",
        ]);
        const rows = parseWindowReadsTsv(tsv);
        expect(rows).toHaveLength(1);
        expect(rows[0].read_id).toBe("read2");
    });

    it("returns empty array for header-only input", () => {
        const rows = parseWindowReadsTsv(HEADER);
        expect(rows).toEqual([]);
    });

    it("returns empty array for empty input", () => {
        const rows = parseWindowReadsTsv("");
        expect(rows).toEqual([]);
    });
});
