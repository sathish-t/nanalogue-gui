// Unit tests for QC mode filter and TSV utilities

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterAndWriteTsv } from "./qc";

/**
 * Helper providing a temp directory with a file path builder.
 */
interface TempDir {
    /** Returns a path to a file in the temp directory. */
    filePath: (name: string) => string;
}

/**
 * Creates a temporary directory and returns a helper to create files within it.
 *
 * @returns An object with a method to create temp file paths.
 */
function makeTempDir(): TempDir {
    const dir = mkdtempSync(join(tmpdir(), "qc-test-"));
    return {
        /**
         * Returns a path to a file in the temp directory.
         *
         * @param name - The file name.
         * @returns The full path.
         */
        filePath: (name: string) => join(dir, name),
    };
}

describe("filterAndWriteTsv", () => {
    it("copies all rows when no filter is applied", async () => {
        const tmp = makeTempDir();
        const src = tmp.filePath("source.tsv");
        const dest = tmp.filePath("dest.tsv");

        writeFileSync(
            src,
            "read_id\tdensity\nread1\t0.3\nread2\t0.7\nread3\t0.9\n",
        );

        await filterAndWriteTsv(src, dest, undefined, undefined, 1);
        const result = readFileSync(dest, "utf-8");
        expect(result).toBe(
            "read_id\tdensity\nread1\t0.3\nread2\t0.7\nread3\t0.9\n",
        );
    });

    it("filters rows by value column range", async () => {
        const tmp = makeTempDir();
        const src = tmp.filePath("source.tsv");
        const dest = tmp.filePath("dest.tsv");

        writeFileSync(
            src,
            "read_id\tdensity\nread1\t0.1\nread2\t0.5\nread3\t0.9\n",
        );

        await filterAndWriteTsv(src, dest, 0.3, 0.8, 1);
        const result = readFileSync(dest, "utf-8");
        expect(result).toBe("read_id\tdensity\nread2\t0.5\n");
    });

    it("uses exclusive upper bound for filtering", async () => {
        const tmp = makeTempDir();
        const src = tmp.filePath("source.tsv");
        const dest = tmp.filePath("dest.tsv");

        writeFileSync(src, "read_id\tdensity\nread1\t0.5\nread2\t0.8\n");

        // filterMax=0.8 should exclude read2 (value === filterMax)
        await filterAndWriteTsv(src, dest, 0.0, 0.8, 1);
        const result = readFileSync(dest, "utf-8");
        expect(result).toBe("read_id\tdensity\nread1\t0.5\n");
    });

    it("handles empty input file with header only", async () => {
        const tmp = makeTempDir();
        const src = tmp.filePath("source.tsv");
        const dest = tmp.filePath("dest.tsv");

        writeFileSync(src, "read_id\tdensity\n");

        await filterAndWriteTsv(src, dest, 0.0, 1.0, 1);
        const result = readFileSync(dest, "utf-8");
        expect(result).toBe("read_id\tdensity\n");
    });

    it("filters on a different column index", async () => {
        const tmp = makeTempDir();
        const src = tmp.filePath("source.tsv");
        const dest = tmp.filePath("dest.tsv");

        writeFileSync(
            src,
            "id\tlen\tdensity\nread1\t100\t0.3\nread2\t200\t0.7\n",
        );

        // Filter on column 2 (density), range 0.5-1.0
        await filterAndWriteTsv(src, dest, 0.5, 1.0, 2);
        const result = readFileSync(dest, "utf-8");
        expect(result).toBe("id\tlen\tdensity\nread2\t200\t0.7\n");
    });
});
