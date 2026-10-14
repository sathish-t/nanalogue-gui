// Unit tests for monty-sandbox helper functions (no BAM files needed).
// Tests resolvePath, toReadOptions, toWindowOptions, safeStringify,
// rejectTreatAsUrl, record/data limits, directory listing, and map conversion.

import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    convertMaps,
    deriveMaxOutputBytes,
    enforceDataSizeLimit,
    enforceRecordLimit,
    isDeniedPath,
    listFilesRecursive,
    rejectTreatAsUrl,
    resolvePath,
    SandboxError,
    safeStringify,
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

describe("isDeniedPath", () => {
    it.each([
        "private.key",
        "cert.pem",
        "cert.crt",
        "cert.cer",
        "archive.p12",
        "archive.pfx",
        "store.credentials",
        "secrets.gpg",
    ])("blocks the sensitive suffix in %s", (filename) => {
        expect(isDeniedPath(`nested/${filename}`)).toBe(true);
    });

    it.each([
        ".env",
        ".env.local",
        "id_rsa",
        "id_ed25519",
        "id_dsa",
        "id_ecdsa",
    ])("blocks the sensitive filename %s case-insensitively", (filename) => {
        expect(isDeniedPath(`nested\\${filename.toUpperCase()}`)).toBe(true);
    });

    it("allows empty and ordinary paths", () => {
        expect(isDeniedPath("")).toBe(false);
        expect(isDeniedPath("nested/safe.txt")).toBe(false);
    });
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

    it("rejects http:// URL", async () => {
        await expect(
            resolvePath(tmpDir, "http://evil.com/ref.fa"),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringContaining("looks like a URL"),
        });
    });

    it("rejects https:// URL", async () => {
        await expect(
            resolvePath(tmpDir, "https://evil.com/ref.fa"),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringContaining("looks like a URL"),
        });
    });

    it("rejects file:// URL", async () => {
        await expect(
            resolvePath(tmpDir, "file:///etc/passwd"),
        ).rejects.toMatchObject({
            name: "ValueError",
            message: expect.stringContaining("looks like a URL"),
        });
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
            threads: 7,
        });
        expect(opts.bamPath).toBe("/data/test.bam");
        expect(opts.sampleFraction).toBe(0.1);
        expect(opts.minSeqLen).toBe(1000);
        expect(opts.mapqFilter).toBe(20);
        expect(opts.readFilter).toBe("primary_forward");
        expect(opts.region).toBe("chr1:1000-2000");
        expect(opts.fullRegion).toBe(true);
        expect(opts.threads).toBe(7);
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

describe("safeStringify", () => {
    it("serializes JSON data and reports non-serializable values", () => {
        expect(safeStringify({ count: 42 })).toEqual({
            ok: true,
            json: '{"count":42}',
        });
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(safeStringify(cyclic).ok).toBe(false);
        expect(safeStringify(undefined).ok).toBe(false);
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
        /**
         * Rejects every test file.
         *
         * @returns True so every test file is rejected.
         */
        const deny = (): boolean => true;
        const { files } = await listFilesRecursive(tmpDir, tmpDir, { deny });
        expect(files).toHaveLength(0);
    });

    it("includes only files matched by the pattern filter", async () => {
        /**
         * Matches BAM files at any depth.
         *
         * @param filePath - Relative test file path.
         * @returns True for BAM files at any depth.
         */
        const pattern = (filePath: string): boolean =>
            filePath.endsWith(".bam");
        const { files } = await listFilesRecursive(tmpDir, tmpDir, {
            pattern,
        });
        for (const f of files) {
            expect(f).toMatch(/\.bam$/);
        }
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
