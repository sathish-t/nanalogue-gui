// Unit tests for monty-sandbox helper functions (no BAM files needed).
// Tests resolvePath, toReadOptions, toWindowOptions, gateOutputSize, rejectTreatAsUrl,
// hasControlChars, enforceRecordLimit, enforceDataSizeLimit, listFilesRecursive, convertMaps.

import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import picomatch from "picomatch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    convertMaps,
    deriveMaxOutputBytes,
    enforceDataSizeLimit,
    enforceRecordLimit,
    gateOutputSize,
    hasControlChars,
    listFilesRecursive,
    rejectTreatAsUrl,
    resolvePath,
    SandboxError,
    toReadOptions,
    toWindowOptions,
} from "./monty-sandbox-helpers";
import { buildSandboxPrompt } from "./sandbox-prompt";

let tmpDir: string;

beforeAll(async () => {
    const raw = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "monty-helpers-test-")),
    );
    // Resolve symlinks so macOS /var → /private/var matches realpath output
    tmpDir = await realpath(raw);
    await writeFile(join(tmpDir, "valid.bam"), "dummy");
    await mkdir(join(tmpDir, "subdir"));
    await writeFile(join(tmpDir, "subdir", "nested.bam"), "dummy");
    // Extra files and symlinks for listFilesRecursive tests.
    await writeFile(join(tmpDir, "extra1.txt"), "x");
    await writeFile(join(tmpDir, "extra2.txt"), "x");
    // fileLink → valid.bam (symlink to a file inside allowedDir).
    await symlink(join(tmpDir, "valid.bam"), join(tmpDir, "fileLink"));
    // escapingLink → parent of tmpDir (outside allowedDir).
    await symlink(join(tmpDir, ".."), join(tmpDir, "escapingLink"));
});

afterAll(async () => {
    await rm(tmpDir, { recursive: true });
});

describe("resolvePath", () => {
    it("resolves valid relative path", async () => {
        const resolved = await resolvePath(tmpDir, "valid.bam");
        expect(resolved).toBe(join(tmpDir, "valid.bam"));
    });

    it("resolves valid nested path", async () => {
        const resolved = await resolvePath(tmpDir, "subdir/nested.bam");
        expect(resolved).toBe(join(tmpDir, "subdir", "nested.bam"));
    });

    it("rejects path traversal with ../", async () => {
        await expect(resolvePath(tmpDir, "../../etc/passwd")).rejects.toThrow(
            /outside the allowed directory/,
        );
    });

    it("rejects absolute path outside allowed dir", async () => {
        await expect(resolvePath(tmpDir, "/etc/passwd")).rejects.toThrow(
            /outside the allowed directory/,
        );
    });
});

describe("toReadOptions", () => {
    it("translates snake_case kwargs to camelCase", () => {
        const opts = toReadOptions("/data/test.bam", {
            sample_fraction: 0.1,
            min_seq_len: 1000,
            mapq_filter: 20,
            read_filter: "primary_forward",
            region: "chr1:1000-2000",
            full_region: true,
        });
        expect(opts.bamPath).toBe("/data/test.bam");
        expect(opts.sampleFraction).toBe(0.1);
        expect(opts.minSeqLen).toBe(1000);
        expect(opts.mapqFilter).toBe(20);
        expect(opts.readFilter).toBe("primary_forward");
        expect(opts.region).toBe("chr1:1000-2000");
        expect(opts.fullRegion).toBe(true);
    });

    it("passes limit and offset from kwargs", () => {
        const opts = toReadOptions("/data/test.bam", {
            limit: 5000,
            offset: 10000,
            sample_seed: 42,
        });
        expect(opts.limit).toBe(5000);
        expect(opts.offset).toBe(10000);
        expect(opts.sampleSeed).toBe(42);
    });

    it("applies limitOverride when kwargs.limit is absent", () => {
        const opts = toReadOptions("/data/test.bam", {}, 200_000);
        expect(opts.limit).toBe(200_000);
    });

    it("kwargs.limit is used when below limitOverride", () => {
        const opts = toReadOptions("/data/test.bam", { limit: 100 }, 200_000);
        expect(opts.limit).toBe(100);
    });

    it("limitOverride caps kwargs.limit when kwargs.limit exceeds it", () => {
        const opts = toReadOptions("/data/test.bam", { limit: 200_000 }, 500);
        expect(opts.limit).toBe(500);
    });

    it("handles empty opts", () => {
        const opts = toReadOptions("/data/test.bam");
        expect(opts.bamPath).toBe("/data/test.bam");
        expect(opts.sampleFraction).toBeUndefined();
        expect(opts.limit).toBeUndefined();
    });
});

describe("toWindowOptions", () => {
    it("includes win, step, and winOp", () => {
        const opts = toWindowOptions("/data/test.bam", {
            win: 100,
            step: 50,
            win_op: "grad_density",
            sample_fraction: 0.5,
        });
        expect(opts.bamPath).toBe("/data/test.bam");
        expect(opts.win).toBe(100);
        expect(opts.step).toBe(50);
        expect(opts.winOp).toBe("grad_density");
        expect(opts.sampleFraction).toBe(0.5);
    });
});

describe("gateOutputSize", () => {
    it("passes through small output", () => {
        const { gated, truncated } = gateOutputSize({ a: 1 }, 1024);
        expect(gated).toEqual({ a: 1 });
        expect(truncated).toBe(false);
    });

    it("truncates large array output", () => {
        const large = Array.from({ length: 1000 }, (_, i) => i);
        const { truncated } = gateOutputSize(large, 100);
        expect(truncated).toBe(true);
    });

    it("returns bounded fallback for cyclic values", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const { gated, truncated } = gateOutputSize(obj, 1024);
        expect(truncated).toBe(true);
        expect(typeof gated).toBe("string");
        expect(gated).toMatch(/cyclic or non-serializable/);
        expect(() => JSON.parse(gated as string)).not.toThrow();
    });

    it("uses Buffer.byteLength for multibyte UTF-8", () => {
        const emoji = "🧬".repeat(10);
        const { truncated } = gateOutputSize(emoji, 20);
        expect(truncated).toBe(true);
    });
});

describe("rejectTreatAsUrl", () => {
    it("does nothing without treat_as_url", () => {
        expect(() => rejectTreatAsUrl({})).not.toThrow();
        expect(() => rejectTreatAsUrl()).not.toThrow();
    });

    it("blocks treat_as_url=true", () => {
        expect(() => rejectTreatAsUrl({ treat_as_url: true })).toThrow(
            /not permitted/,
        );
    });
});

describe("deriveMaxOutputBytes", () => {
    it("clamps to minimum for small context", () => {
        const result = deriveMaxOutputBytes(1000);
        expect(result).toBe(4096);
    });

    it("returns 15% for mid-range context", () => {
        const result = deriveMaxOutputBytes(32_000);
        expect(result).toBe(Math.round(32_000 * 4 * 0.15));
    });

    it("clamps to maximum for large context", () => {
        const result = deriveMaxOutputBytes(1_000_000);
        expect(result).toBe(80 * 1024);
    });
});

describe("hasControlChars", () => {
    it("returns false for a normal filename", () => {
        expect(hasControlChars("report.bam")).toBe(false);
    });

    it("returns true for a null byte", () => {
        expect(hasControlChars("bad\x00name")).toBe(true);
    });

    it("returns true for a DEL character (0x7F)", () => {
        expect(hasControlChars("bad\x7fname")).toBe(true);
    });

    it("returns true for a control character in the middle", () => {
        expect(hasControlChars("a\x1fb")).toBe(true);
    });
});

describe("enforceRecordLimit", () => {
    it("does not throw when within limit", () => {
        expect(() =>
            enforceRecordLimit([1, 2, 3], "read_info", 5),
        ).not.toThrow();
    });

    it("throws SandboxError when result exceeds limit", () => {
        const result = [1, 2, 3, 4, 5, 6];
        expect(() => enforceRecordLimit(result, "read_info", 5)).toThrow(
            SandboxError,
        );
        expect(() => enforceRecordLimit(result, "read_info", 5)).toThrow(
            /read_info returned 6/,
        );
    });

    it("thrown error has name ValueError", () => {
        try {
            enforceRecordLimit([1, 2, 3], "fn", 2);
            expect.fail("should have thrown");
        } catch (e) {
            expect((e as SandboxError).name).toBe("ValueError");
        }
    });
});

describe("enforceDataSizeLimit", () => {
    it("passes through data under the limit", () => {
        const result = enforceDataSizeLimit("small\n", "seq_table", 1024);
        expect(result).toBe("small\n");
    });

    it("truncates at a newline boundary when one fits", () => {
        // "line1\n" is 6 bytes; with maxBytes=10 the newline at index 5
        // is within range, so cutPoint = 5 (the lastNewline position).
        const data = "line1\nline2\nline3\n";
        const result = enforceDataSizeLimit(data, "seq_table", 10);
        expect(result).toContain("[TRUNCATED by seq_table");
        expect(result).toContain("line1");
        expect(result).not.toContain("line2");
    });

    it("truncates at maxBytes when no newline fits in the window", () => {
        // A string of 200 'a's has no newlines; cutPoint falls back to maxBytes.
        const result = enforceDataSizeLimit("a".repeat(200), "fn", 10);
        expect(result).toContain("[TRUNCATED by fn");
    });
});

describe("listFilesRecursive", () => {
    it("caps results at maxEntries and sets capped=true", async () => {
        // tmpDir contains valid.bam, extra1.txt, extra2.txt, fileLink,
        // escapingLink (skipped), and subdir/nested.bam — more than 2 results.
        const { files, capped } = await listFilesRecursive(tmpDir, tmpDir, {
            maxEntries: 2,
        });
        expect(capped).toBe(true);
        expect(files.length).toBeLessThanOrEqual(2);
    });

    it("follows a symlink that resolves to a file inside allowedDir", async () => {
        // fileLink → valid.bam; resolvePath follows the symlink, lstat on the
        // resolved target shows a regular file, so it is added as "valid.bam".
        // That makes "valid.bam" appear twice: once from the direct file entry
        // and once from the symlink entry.
        const { files } = await listFilesRecursive(tmpDir, tmpDir, {});
        expect(files.filter((f) => f === "valid.bam").length).toBe(2);
    });

    it("skips a symlink that resolves outside allowedDir", async () => {
        // escapingLink → parent of tmpDir; resolvePath throws → continue.
        const { files } = await listFilesRecursive(tmpDir, tmpDir, {});
        expect(files).not.toContain("escapingLink");
    });

    it("excludes files matched by the deny filter", async () => {
        // deny everything — no files should appear.
        const deny = picomatch("**");
        const { files } = await listFilesRecursive(tmpDir, tmpDir, { deny });
        expect(files).toHaveLength(0);
    });

    it("includes only files matched by the pattern filter", async () => {
        const pattern = picomatch("**/*.bam");
        const { files } = await listFilesRecursive(tmpDir, tmpDir, {
            pattern,
        });
        for (const f of files) {
            expect(f).toMatch(/\.bam$/);
        }
    });
});

describe("gateOutputSize — object branch", () => {
    it("truncates a large array field inside an object", () => {
        // data field is a large array that exceeds maxBytes / 4.
        const bigArr = Array.from({ length: 500 }, (_, i) => ({
            index: i,
            value: "x".repeat(10),
        }));
        const obj = { data: bigArr, label: "test" };
        const { gated, truncated } = gateOutputSize(obj, 200);
        expect(truncated).toBe(true);
        expect(gated).toBeDefined();
    });

    it("truncates a large string field inside an object", () => {
        // content field is a long string that exceeds maxBytes / 4.
        const obj = { content: "x".repeat(5000), count: 1 };
        const { gated, truncated } = gateOutputSize(obj, 200);
        expect(truncated).toBe(true);
        expect(gated).toBeDefined();
    });

    it("hard-truncates when the object is still too large after field truncation", () => {
        // A single key 300 chars long — the key itself makes the serialised
        // object exceed maxBytes even after structural truncation.
        const obj: Record<string, unknown> = {};
        obj["k".repeat(300)] = 42;
        const { gated, truncated } = gateOutputSize(obj, 100);
        expect(truncated).toBe(true);
        expect(typeof gated).toBe("string");
        expect(gated as string).toContain("[TRUNCATED");
    });
});

describe("gateOutputSize — string branch with newline", () => {
    it("truncates at a newline boundary for long strings", () => {
        // String contains newlines within the first maxBytes chars;
        // cutPoint should land at the last newline position.
        const data = "line1\nline2\nline3\n".repeat(50);
        const { gated, truncated } = gateOutputSize(data, 20);
        expect(truncated).toBe(true);
        expect(typeof gated).toBe("string");
        expect(gated as string).toContain("[TRUNCATED");
    });
});

describe("convertMaps", () => {
    it("converts a Map to a plain object", () => {
        const m = new Map<string, unknown>([
            ["a", 1],
            ["b", 2],
        ]);
        expect(convertMaps(m)).toEqual({ a: 1, b: 2 });
    });

    it("converts a plain object recursively", () => {
        const obj = { x: 1, nested: { y: 2 } };
        expect(convertMaps(obj)).toEqual({ x: 1, nested: { y: 2 } });
    });

    it("converts an array containing Maps", () => {
        const arr = [new Map([["k", 99]]), 42];
        expect(convertMaps(arr)).toEqual([{ k: 99 }, 42]);
    });

    it("returns primitives unchanged", () => {
        expect(convertMaps(42)).toBe(42);
        expect(convertMaps("hello")).toBe("hello");
        expect(convertMaps(null)).toBeNull();
    });
});

describe("buildSandboxPrompt", () => {
    it("does not contain static file listing", () => {
        const prompt = buildSandboxPrompt({
            maxOutputKB: 20,
            maxRecordsReadInfo: 200_000,
            maxRecordsBamMods: 5_000,
            maxRecordsWindowReads: 5_000,
            maxRecordsSeqTable: 5_000,
            maxReadMB: 1,
            maxWriteMB: 50,
            maxDurationSecs: 600,
        });
        expect(prompt).not.toMatch(/Files available:/i);
        expect(prompt).toContain("ls()");
    });

    it("interpolates maxOutputKB", () => {
        const prompt = buildSandboxPrompt({
            maxOutputKB: 42,
            maxRecordsReadInfo: 200_000,
            maxRecordsBamMods: 5_000,
            maxRecordsWindowReads: 5_000,
            maxRecordsSeqTable: 5_000,
            maxReadMB: 1,
            maxWriteMB: 50,
            maxDurationSecs: 600,
        });
        expect(prompt).toContain("42 KB");
    });
});
