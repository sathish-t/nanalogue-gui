// Unit tests for streaming line counting utilities

import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countBedDataLines, countNonEmptyLines } from "./line-counter";

/** Paths of temporary files created during the current test, removed in afterEach. */
const tempFiles: string[] = [];

afterEach(async () => {
    await Promise.all(tempFiles.map((p) => unlink(p).catch(() => {})));
    tempFiles.length = 0;
});

/**
 * Creates a temporary file with the given content and returns its path.
 * The file is registered for cleanup after each test.
 *
 * @param content - The file content to write.
 * @returns The filesystem path to the temporary file.
 */
async function writeTempFile(content: string): Promise<string> {
    const path = join(tmpdir(), `test-${Date.now()}-${Math.random()}.bed`);
    await writeFile(path, content, "utf-8");
    tempFiles.push(path);
    return path;
}

describe("countBedDataLines", () => {
    it("counts data lines in a normal BED file", async () => {
        const path = await writeTempFile(
            "chr1\t100\t200\tread1\nchr2\t300\t400\tread2\nchr3\t500\t600\tread3\n",
        );
        expect(await countBedDataLines(path)).toBe(3);
    });

    it("skips empty lines", async () => {
        const path = await writeTempFile(
            "chr1\t100\t200\tread1\n\nchr2\t300\t400\tread2\n\n\n",
        );
        expect(await countBedDataLines(path)).toBe(2);
    });

    it("skips whitespace-only lines", async () => {
        const path = await writeTempFile(
            "chr1\t100\t200\tread1\n   \nchr2\t300\t400\tread2\n\t\n",
        );
        expect(await countBedDataLines(path)).toBe(2);
    });

    it("skips comment lines starting with #", async () => {
        const path = await writeTempFile(
            "# header comment\nchr1\t100\t200\tread1\n# another comment\n",
        );
        expect(await countBedDataLines(path)).toBe(1);
    });

    it("skips track header lines", async () => {
        const path = await writeTempFile(
            "track name=example\nchr1\t100\t200\tread1\n",
        );
        expect(await countBedDataLines(path)).toBe(1);
    });

    it("skips browser header lines", async () => {
        const path = await writeTempFile(
            "browser position chr1:100-200\nchr1\t100\t200\tread1\n",
        );
        expect(await countBedDataLines(path)).toBe(1);
    });

    it("skips all header types combined", async () => {
        const path = await writeTempFile(
            "# comment\nbrowser position chr1:100-200\ntrack name=example\nchr1\t100\t200\tread1\nchr2\t300\t400\tread2\n",
        );
        expect(await countBedDataLines(path)).toBe(2);
    });

    it("does not skip contigs starting with track or browser", async () => {
        const path = await writeTempFile(
            "track1\t100\t200\tread1\nbrowserX\t300\t400\tread2\n",
        );
        expect(await countBedDataLines(path)).toBe(2);
    });

    it("returns 0 for an empty file", async () => {
        const path = await writeTempFile("");
        expect(await countBedDataLines(path)).toBe(0);
    });

    it("returns 0 for a file with only headers", async () => {
        const path = await writeTempFile(
            "# comment\ntrack name=example\nbrowser position chr1:100-200\n",
        );
        expect(await countBedDataLines(path)).toBe(0);
    });

    it("handles CRLF line endings", async () => {
        const path = await writeTempFile(
            "chr1\t100\t200\tread1\r\nchr2\t300\t400\tread2\r\n",
        );
        expect(await countBedDataLines(path)).toBe(2);
    });
});

describe("countNonEmptyLines", () => {
    it("counts non-empty lines in a file", async () => {
        const path = await writeTempFile("read1\nread2\nread3\n");
        expect(await countNonEmptyLines(path)).toBe(3);
    });

    it("skips empty and whitespace-only lines", async () => {
        const path = await writeTempFile("read1\n\n  \nread2\n");
        expect(await countNonEmptyLines(path)).toBe(2);
    });

    it("returns 0 for an empty file", async () => {
        const path = await writeTempFile("");
        expect(await countNonEmptyLines(path)).toBe(0);
    });

    it("handles CRLF line endings", async () => {
        const path = await writeTempFile("line1\r\nline2\r\n");
        expect(await countNonEmptyLines(path)).toBe(2);
    });
});
