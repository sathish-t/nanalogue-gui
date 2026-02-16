// Integration tests for monty-sandbox with real BAM fixtures.
// Uses simulateModBam from @nanalogue/node to generate test BAM files.

import {
    mkdir,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { simulateModBam } from "@nanalogue/node";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolvePath, runSandboxCode } from "./monty-sandbox";

let allowedDir: string;
let bamName: string;

beforeAll(async () => {
    const raw = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "monty-sandbox-test-")),
    );
    // Resolve symlinks so macOS /var → /private/var matches realpath output
    allowedDir = await realpath(raw);
    const configPath = resolve(
        __dirname,
        "../../tests/data/simulation_configs/simple_bam.json",
    );
    const config = await readFile(configPath, "utf-8");
    bamName = "simple_test.bam";
    await simulateModBam({
        jsonConfig: config,
        bamPath: join(allowedDir, bamName),
        fastaPath: join(allowedDir, "simple_test.fasta"),
    });
}, 60_000);

afterAll(async () => {
    await rm(allowedDir, { recursive: true });
});

it("peek returns contigs via sandbox", async () => {
    const code = `
info = peek("${bamName}")
list(info["contigs"].keys())
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.value).toBeInstanceOf(Array);
    expect((result.value as string[]).length).toBeGreaterThan(0);
});

it("read_info returns records via sandbox", async () => {
    const code = `
reads = read_info("${bamName}", min_seq_len=100)
len(reads)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(typeof result.value).toBe("number");
    expect(result.value as number).toBeGreaterThan(0);
});

it("bam_mods returns modification data via sandbox", async () => {
    const code = `
mods = bam_mods("${bamName}", sample_fraction=0.01)
len(mods)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(typeof result.value).toBe("number");
});

it("window_reads returns TSV string via sandbox", async () => {
    const code = `
tsv = window_reads("${bamName}", win=100, step=50)
len(tsv)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(typeof result.value).toBe("number");
    expect(result.value as number).toBeGreaterThan(0);
});

it("seq_table returns TSV string via sandbox", async () => {
    const code = `
tsv = seq_table("${bamName}", region="contig_00000", limit=10)
len(tsv)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(typeof result.value).toBe("number");
    expect(result.value as number).toBeGreaterThan(0);
});

it("ls lists files in allowed directory", async () => {
    const code = `
files = ls()
bam_files = [f for f in files if f.endswith(".bam")]
bam_files
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.value).toBeInstanceOf(Array);
    expect(result.value).toContain(bamName);
});

it("path traversal is blocked", async () => {
    const code = 'peek("../../etc/passwd")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("RuntimeError");
    expect(result.message).toMatch(/outside the allowed directory/);
});

it("URL access is blocked", async () => {
    const code = `peek("${bamName}", treat_as_url=True)`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not permitted/);
});

it("timeout raises error with isTimeout flag", async () => {
    const code = `
while True:
    pass
`;
    const result = await runSandboxCode(code, allowedDir, {
        maxDurationSecs: 0.1,
    });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
});

it("LLM-style processing produces summary dict", async () => {
    const code = `
info = peek("${bamName}")
reads = read_info("${bamName}", sample_fraction=0.05)
mods = info["modifications"]
mod_types = [m[2] for m in mods]
{
    "num_contigs": len(info["contigs"]),
    "mod_types": mod_types,
    "num_reads": len(reads),
}
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const summary = result.value as Record<string, unknown>;
    expect(summary).toHaveProperty("num_contigs");
    expect(summary).toHaveProperty("mod_types");
    expect(summary).toHaveProperty("num_reads");
});

it("symlink outside allowed dir is blocked", async () => {
    const outsideDir = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "outside-")),
    );
    const outsidePath = join(outsideDir, "outside.bam");
    await writeFile(outsidePath, "not a bam");
    const linkPath = join(allowedDir, "link_to_outside.bam");
    await symlink(outsidePath, linkPath);

    const code = 'peek("link_to_outside.bam")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/outside the allowed directory/);

    await rm(outsideDir, { recursive: true });
});

// The htslib C library prints "[E::hts_hopen] Failed to open file" to stderr
// when it tries to open a directory as a BAM file. This is expected behavior.
it("directory path is rejected", async () => {
    await mkdir(join(allowedDir, "subdir"), { recursive: true });
    const code = 'peek("subdir")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
});

it("output exceeding maxOutputBytes is truncated", async () => {
    const code = `
reads = read_info("${bamName}")
reads
`;
    const result = await runSandboxCode(code, allowedDir, {
        maxOutputBytes: 1024,
    });
    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
});

it("code ending with assignment sets endedWithExpression false", async () => {
    const code = `
x = peek("${bamName}")
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.endedWithExpression).toBe(false);
});

it("sandbox code can catch exceptions with try/except", async () => {
    const code = `
try:
    info = peek("nonexistent.bam")
except Exception as e:
    info = {"error": str(e)}
info
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect((result.value as Record<string, string>).error).toBeDefined();
});

it("read_file reads a text file within allowed dir", async () => {
    await writeFile(
        join(allowedDir, "annotations.bed"),
        "chr1\t100\t200\nchr1\t300\t400\n",
    );
    const code = `
result = read_file("annotations.bed")
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.content).toContain("chr1\t100\t200");
    expect(value.bytes_read).toBeGreaterThan(0);
    expect(value.total_size).toBeGreaterThan(0);
    expect(value.offset).toBe(0);
});

it("read_file respects offset and max_bytes for pagination", async () => {
    const content = "AAAAAAAAAA" + "BBBBBBBBBB" + "CCCCCCCCCC";
    await writeFile(join(allowedDir, "paged.txt"), content);
    const code = `
result = read_file("paged.txt", offset=10, max_bytes=10)
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.content).toBe("BBBBBBBBBB");
    expect(value.bytes_read).toBe(10);
    expect(value.total_size).toBe(30);
    expect(value.offset).toBe(10);
});

it("read_file rejects path traversal", async () => {
    const code = 'read_file("../../etc/passwd")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/outside the allowed directory/);
});

it("write_file creates file in ai_chat_output subdirectory", async () => {
    const code = `
result = write_file("results.bed", "chr1\\t100\\t200\\n")
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.path).toBe("ai_chat_output/results.bed");
    expect(value.bytes_written).toBeGreaterThan(0);

    const fs = await import("node:fs/promises");
    const written = await fs.readFile(
        join(allowedDir, "ai_chat_output", "results.bed"),
        "utf-8",
    );
    expect(written).toBe("chr1\t100\t200\n");
});

it("write_file refuses to overwrite existing file", async () => {
    const code1 = 'write_file("no_overwrite.txt", "first")';
    const result1 = await runSandboxCode(code1, allowedDir);
    expect(result1.success).toBe(true);

    const code2 = 'write_file("no_overwrite.txt", "second")';
    const result2 = await runSandboxCode(code2, allowedDir);
    expect(result2.success).toBe(false);
    expect(result2.message).toMatch(/already exists/);
});

it("write_file rejects path traversal outside ai_chat_output", async () => {
    const code = 'write_file("../tumor.bam", "malicious content")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/outside the allowed directory/);
});

it("write_file supports nested paths with auto-created directories", async () => {
    const code = `
result = write_file("chr1/region_a/filtered.bed", "chr1\\t500\\t600\\n")
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.path).toBe("ai_chat_output/chr1/region_a/filtered.bed");
    expect(value.bytes_written).toBeGreaterThan(0);
});

it("read_file can read back write_file output", async () => {
    const code = `
write_file("roundtrip.tsv", "read_id\\tlen\\nread1\\t1000\\n")
result = read_file("ai_chat_output/roundtrip.tsv")
result["content"]
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.value).toContain("read_id\tlen");
    expect(result.value).toContain("read1\t1000");
});

it("ls shows write_file output in listing", async () => {
    const code = `
result = write_file("visible.txt", "hello")
files = ls()
[f for f in files if "visible.txt" in f]
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.value).toContain("ai_chat_output/visible.txt");
});

it("read_info respects native limit parameter", async () => {
    const code = `
reads = read_info("${bamName}", limit=5)
len(reads)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(result.value as number).toBeLessThanOrEqual(5);
});

it("read_info supports pagination via offset", async () => {
    const code1 = `
p1 = read_info("${bamName}", limit=10, offset=0)
len(p1)
`;
    const r1 = await runSandboxCode(code1, allowedDir);
    expect(r1.success).toBe(true);

    const code2 = `
p2 = read_info("${bamName}", limit=10, offset=10)
len(p2)
`;
    const r2 = await runSandboxCode(code2, allowedDir);
    expect(r2.success).toBe(true);
    expect(r2.value as number).toBeGreaterThan(0);
});

it("read_file rejects NaN offset", async () => {
    const code = 'read_file("annotations.bed", offset=float("nan"))';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/offset must be a non-negative integer/);
});

it("read_file rejects Infinity max_bytes", async () => {
    const code = 'read_file("annotations.bed", max_bytes=float("inf"))';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/max_bytes must be a non-negative integer/);
});

it("read_file rejects string offset", async () => {
    const code = 'read_file("annotations.bed", offset="10")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/offset must be a non-negative integer/);
});

it("read_file rejects fractional offset", async () => {
    const code = 'read_file("annotations.bed", offset=10.5)';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/offset must be a non-negative integer/);
});

it("resolvePath returns real path for symlink to file", async () => {
    await writeFile(join(allowedDir, "resolve_target.txt"), "content");
    await symlink(
        join(allowedDir, "resolve_target.txt"),
        join(allowedDir, "resolve_link.txt"),
    );

    const result = await resolvePath(allowedDir, "resolve_link.txt");
    expect(result).toBe(join(allowedDir, "resolve_target.txt"));
});

it("resolvePath returns real path for symlink to directory", async () => {
    await mkdir(join(allowedDir, "resolve_target_dir"), { recursive: true });
    await symlink(
        join(allowedDir, "resolve_target_dir"),
        join(allowedDir, "resolve_link_dir"),
    );

    const result = await resolvePath(allowedDir, "resolve_link_dir");
    expect(result).toBe(join(allowedDir, "resolve_target_dir"));
});

it("resolvePath rejects symlink to file outside allowed dir", async () => {
    const outsideDir = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "outside-resolve-")),
    );
    const outsideFile = join(outsideDir, "secret.txt");
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, join(allowedDir, "escape_link.txt"));

    await expect(resolvePath(allowedDir, "escape_link.txt")).rejects.toThrow(
        /outside the allowed directory/,
    );

    await rm(outsideDir, { recursive: true });
});

it("resolvePath rejects symlink to directory outside allowed dir", async () => {
    const outsideDir = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "outside-resolve-dir-")),
    );
    await symlink(outsideDir, join(allowedDir, "escape_link_dir"));

    await expect(resolvePath(allowedDir, "escape_link_dir")).rejects.toThrow(
        /outside the allowed directory/,
    );

    await rm(outsideDir, { recursive: true });
});

it("ls returns resolved path for symlink-to-directory", async () => {
    await mkdir(join(allowedDir, "real_subdir"), { recursive: true });
    await writeFile(join(allowedDir, "real_subdir", "data.txt"), "hello");
    await symlink(
        join(allowedDir, "real_subdir"),
        join(allowedDir, "link_subdir"),
    );

    const code = `
files = ls()
[f for f in files if "data.txt" in f]
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const files = result.value as string[];
    expect(files).toContain("real_subdir/data.txt");
    expect(files).not.toContain("link_subdir/data.txt");
});

it("ls returns resolved path for symlink-to-file", async () => {
    await writeFile(join(allowedDir, "real_file.txt"), "hello");
    await symlink(
        join(allowedDir, "real_file.txt"),
        join(allowedDir, "link_file.txt"),
    );

    const code = `
files = ls()
[f for f in files if "link_file" in f or "real_file" in f]
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const files = result.value as string[];
    // Should contain the real path, not the symlink path
    expect(files).toContain("real_file.txt");
    expect(files).not.toContain("link_file.txt");
});
