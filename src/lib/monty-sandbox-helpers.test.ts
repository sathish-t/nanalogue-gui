// Unit tests for monty-sandbox helper functions (no BAM files needed).
// Tests resolvePath, toReadOptions, toWindowOptions, gateOutputSize, rejectTreatAsUrl.

import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    deriveMaxOutputBytes,
    gateOutputSize,
    rejectTreatAsUrl,
    resolvePath,
    toReadOptions,
    toWindowOptions,
} from "./monty-sandbox";
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

    it("kwargs.limit takes precedence over limitOverride", () => {
        const opts = toReadOptions("/data/test.bam", { limit: 100 }, 200_000);
        expect(opts.limit).toBe(100);
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
