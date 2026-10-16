// Integration tests for monty-sandbox with real BAM fixtures.
// Uses simulateModBam from @nanalogue/node to generate test BAM files.

import * as crypto from "node:crypto";
import {
    mkdir,
    readdir,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { simulateModBam } from "@nanalogue/node";
import { runMontyAsync } from "@pydantic/monty";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_WRITE_BYTES } from "./ai-chat-constants";
import { buildExecutionFeedback } from "./chat-orchestrator-execution";
import {
    collectTerminalOutput,
    runSandboxCode,
    wrapForMonty,
} from "./monty-sandbox";
import { resolvePath, SandboxError } from "./monty-sandbox-helpers";

vi.mock("node:crypto", { spy: true });

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

it("read_info handles 10,000 methylated 10 kb reads with default sandbox limits", async () => {
    await simulateModBam({
        jsonConfig: JSON.stringify({
            contigs: { number: 1, len_range: [10_000, 10_000] },
            reads: [
                {
                    number: 10_000,
                    mapq_range: [10, 20],
                    base_qual_range: [10, 20],
                    len_range: [1, 1],
                    mods: [
                        {
                            base: "C",
                            is_strand_plus: true,
                            mod_code: "m",
                            win: [40, 40],
                            mod_range: [
                                [0.1, 0.2],
                                [0.7, 0.8],
                            ],
                        },
                    ],
                },
            ],
        }),
        bamPath: join(allowedDir, "ten-thousand.bam"),
        fastaPath: join(allowedDir, "ten-thousand.fasta"),
    });

    const result = await runSandboxCode(
        `reads = read_info("ten-thousand.bam")
lengths = [r["sequence_length"] for r in reads]
mod_codes = [m[2] for m in peek("ten-thousand.bam")["modifications"]]
[len(reads), min(lengths), max(lengths), mod_codes]`,
        allowedDir,
    );
    expect(result, JSON.stringify(result)).toMatchObject({
        success: true,
        value: [10_000, 10_000, 10_000, ["m"]],
    });
}, 60_000);

it("bam_mods returns modification data via sandbox", async () => {
    const code = `
mods = bam_mods("${bamName}", sample_fraction=0.01)
len(mods)
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    expect(typeof result.value).toBe("number");
});

it("window_reads returns an array via sandbox", async () => {
    const code = `
records = window_reads("${bamName}", win=100, step=50)
len(records)
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

it.each([
    6, 21000,
])("timeout preserves %s printed characters and isTimeout", async (length) => {
    const code = `print("x" * ${length})\nwhile True:\n    pass`;
    const result = await runSandboxCode(code, allowedDir, {
        maxDurationSecs: 0.1,
    });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
    const output = result.prints?.join("") ?? "";
    if (length === 6) {
        expect(output).toBe("xxxxxx\n");
    } else {
        const path = output.match(
            /ai_chat_output\/python-prints-[\w-]+\.txt/,
        )?.[0];
        expect(path).toBeDefined();
        expect(await readFile(join(allowedDir, path ?? ""), "utf-8")).toBe(
            `${"x".repeat(length)}\n`,
        );
    }
});

it("bash abort via wall-clock timer sets isTimeout", async () => {
    // Timer fires at 100ms; bash sleeps for 2s — abort cancels bash mid-flight.
    const code = `bash("sleep 2")`;
    const result = await runSandboxCode(code, allowedDir, {
        maxDurationSecs: 0.1,
    });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
}, 10_000);

it("bash abort caught by try/except still surfaces as isTimeout", async () => {
    // Python catches the abort error — without the success-path bashTimedOut
    // guard this would incorrectly return success: true.
    const code = `
try:
    bash("sleep 2")
except:
    pass
"completed"
`;
    const result = await runSandboxCode(code, allowedDir, {
        maxDurationSecs: 0.1,
    });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
}, 10_000);

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

it.each([
    ["string", '"🧬" * 100', "🧬".repeat(100), "string"],
    ["list", '["x" * 300, "kept"]', ["x".repeat(300), "kept"], "array (list)"],
    [
        "dictionary",
        '{"summary": "x" * 300, "count": 42}',
        { summary: "x".repeat(300), count: 42 },
        "object (dictionary)",
    ],
])("saves an overflowing %s in full instead of truncating it", async (_name, code, expected, outputType) => {
    const result = await runSandboxCode(code, allowedDir, {
        maxOutputBytes: 100,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.value).toMatch(/Python execution completed.*inline limit/);
    expect(result.value).toContain(`Top-level JSON type: ${outputType}.`);
    expect(result.value).toContain(
        "complete returned value, with no wrapper or execution metadata",
    );
    const readExpression = String(result.value).match(
        /json\.loads\(read_file\("[^"]+"\)\["content"\]\)/,
    )?.[0];
    expect(readExpression).toBeDefined();
    const reread = await runSandboxCode(
        `import json\n${readExpression}`,
        allowedDir,
        { maxOutputBytes: 1000 },
    );
    expect(reread).toMatchObject({ success: true, value: expected });
    const path = String(result.value).match(
        /ai_chat_output\/python-result-[\w-]+\.json/,
    )?.[0];
    expect(path).toBeDefined();
    const content = await readFile(join(allowedDir, path ?? ""), "utf-8");
    expect(JSON.parse(content)).toEqual(expected);
    expect(result.truncated).toBe(false);
    expect(result.outputFile).toBe(path);
    const feedback = JSON.parse(
        buildExecutionFeedback(result, 2).replace(
            "Code execution result: ",
            "",
        ),
    );
    expect(feedback.output_file).toBe(path);
    expect(feedback.value).toBe(result.value);
    expect(collectTerminalOutput(result)).toContain(path);
});

it("warns when an overflow file exceeds the configured read_file limit", async () => {
    const result = await runSandboxCode('"x" * 300', allowedDir, {
        maxOutputBytes: 100,
        maxReadBytes: 128,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.value).toContain("read_file's 128-byte per-call limit");
    expect(result.value).toContain(
        "Do not json.loads a partial read_file result",
    );
    expect(result.value).toContain("increase the configured read limit");
    expect(result.value).not.toContain('json.loads(read_file("');
    const chunk = await runSandboxCode(
        `read_file("${result.outputFile}")`,
        allowedDir,
        { maxReadBytes: 128, maxOutputBytes: 1000 },
    );
    expect(chunk).toMatchObject({
        success: true,
        value: {
            bytes_read: 128,
            total_size: 302,
            content: `"${"x".repeat(127)}`,
        },
    });
});

it.each([
    ["number", "42", 42, 2],
    ["boolean", "True", true, 4],
])("keeps an inline %s but rejects saving an overflowing one", async (_name, code, expected, inlineBytes) => {
    const inline = await runSandboxCode(code, allowedDir, {
        maxOutputBytes: inlineBytes,
    });
    expect(inline).toMatchObject({ success: true, value: expected });
    const dir = join(allowedDir, `scalar-overflow-${_name}`);
    await mkdir(dir);
    const overflow = await runSandboxCode(
        `write_file("side-effect.txt", "completed")\n${code}`,
        dir,
        { maxOutputBytes: 1 },
    );
    expect(overflow).toMatchObject({
        success: false,
        errorType: "OutputError",
        message: expect.stringContaining(
            "Only strings, lists, and dictionaries can be saved as overflow files",
        ),
    });
    expect(overflow).not.toHaveProperty("outputFile");
    expect(await readdir(dir)).not.toContain("ai_chat_output");
    expect(await readFile(join(dir, "side-effect.txt"), "utf-8")).toBe(
        "completed",
    );
});

it("keeps a result at the inline byte boundary and saves one byte over it", async () => {
    const inline = await runSandboxCode('"🧬" * 10', allowedDir, {
        maxOutputBytes: 42,
    });
    expect(inline.success).toBe(true);
    expect(inline.value).toBe("🧬".repeat(10));
    expect(inline).not.toHaveProperty("outputFile");
    const overflow = await runSandboxCode('"🧬" * 10', allowedDir, {
        maxOutputBytes: 41,
    });
    expect(overflow.success).toBe(true);
    expect(overflow).toHaveProperty("outputFile");
});

it.each([
    "value",
    "prints",
])("does not overwrite an existing %s overflow filename", async (kind) => {
    const id = "00000000-0000-4000-8000-000000000008";
    const path =
        kind === "value"
            ? `ai_chat_output/python-result-${id}.json`
            : `ai_chat_output/python-prints-${id}.txt`;
    await mkdir(join(allowedDir, "ai_chat_output"), { recursive: true });
    await writeFile(join(allowedDir, path), "existing data");
    const uuid = vi.mocked(crypto.randomUUID).mockReturnValue(id);
    try {
        const result = await runSandboxCode(
            kind === "value" ? '"x" * 300' : 'print("x" * 300)',
            allowedDir,
            {
                maxOutputBytes: 100,
            },
        );
        expect(result.success).toBe(false);
        expect(result).toMatchObject({
            errorType: "OutputError",
            message: expect.stringContaining("saving"),
        });
        expect(await readFile(join(allowedDir, path), "utf-8")).toBe(
            "existing data",
        );
    } finally {
        uuid.mockRestore();
    }
});

it.each([
    "value",
    "prints",
])("blocks %s overflow saving outside the allowed directory without undoing execution", async (kind) => {
    const dir = join(allowedDir, `save-failure-${kind}`);
    const outside = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "outside-output-")),
    );
    await mkdir(dir);
    await symlink(outside, join(dir, "ai_chat_output"));
    try {
        const result = await runSandboxCode(
            'write_file("side-effect.txt", "completed")\nprint("finished")\n' +
                (kind === "value" ? '"x" * 300' : 'print("x" * 300)'),
            dir,
            { maxOutputBytes: 100 },
        );
        expect(result).toMatchObject({
            success: false,
            errorType: "OutputError",
            message: expect.stringContaining("saving"),
        });
        expect(result.prints?.join("")).toBe(
            kind === "value" ? "finished\n" : "",
        );
        expect(await readdir(outside)).toEqual([]);
        expect(await readFile(join(dir, "side-effect.txt"), "utf-8")).toBe(
            "completed",
        );
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

it("reports completed execution when the returned value cannot be serialized", async () => {
    const result = await runSandboxCode("2 ** 100", allowedDir);
    expect(result).toMatchObject({
        success: false,
        errorType: "OutputError",
        message: expect.stringContaining(
            "Python execution completed, but its returned output could not be serialized",
        ),
    });
});

it("saves a result exactly at the 50 MiB file limit", async () => {
    const result = await runSandboxCode(
        `"x" * ${DEFAULT_MAX_WRITE_BYTES - 2}`,
        allowedDir,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    const content = await readFile(
        join(allowedDir, result.outputFile ?? ""),
        "utf-8",
    );
    expect(Buffer.byteLength(content)).toBe(DEFAULT_MAX_WRITE_BYTES);
    expect(JSON.parse(content)).toBe("x".repeat(DEFAULT_MAX_WRITE_BYTES - 2));
}, 30_000);

it("fails above 50 MiB without saving the result or undoing Python file writes", async () => {
    const dir = join(allowedDir, "over-file-limit");
    await mkdir(dir);
    const result = await runSandboxCode(
        `write_file("side-effect.txt", "completed")\n"x" * ${DEFAULT_MAX_WRITE_BYTES - 1}`,
        dir,
        { maxOutputBytes: DEFAULT_MAX_WRITE_BYTES + 100 },
    );
    expect(result).toMatchObject({
        success: false,
        errorType: "OutputError",
        message: expect.stringContaining("Python execution completed"),
    });
    if (result.success) throw new Error("Expected output delivery failure");
    expect(result.message).toContain("exceeded the 50 MiB limit");
    expect(result.message).toContain("not saved or returned");
    expect(result.message).toContain(
        "Any files written during execution remain",
    );
    expect(await readFile(join(dir, "side-effect.txt"), "utf-8")).toBe(
        "completed",
    );
    expect(await readdir(dir)).not.toContain("ai_chat_output");
}, 30_000);

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

it("runSandboxCode threads maxReadBytes through to bash", async () => {
    await writeFile(join(allowedDir, "oversized.txt"), "hello world");
    const code = `
result = bash("cat oversized.txt")
result
`;
    // runSandboxCode sets cwd to allowedDir, so the relative path here is
    // the same shape an LLM-generated script would use inside the sandbox.
    const result = await runSandboxCode(code, allowedDir, { maxReadBytes: 4 });
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.exit_code).not.toBe(0);
    expect(typeof value.stderr).toBe("string");
    expect(value.stderr).toContain("No such file or directory");
});

it("read_file rejects path traversal", async () => {
    const code = 'read_file("../../etc/passwd")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/outside the allowed directory/);
});

it("write_file creates file at given path within allowed dir", async () => {
    const code = `
result = write_file("results.bed", "chr1\\t100\\t200\\n")
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.path).toBe("results.bed");
    expect(value.bytes_written).toBeGreaterThan(0);

    const fs = await import("node:fs/promises");
    const written = await fs.readFile(join(allowedDir, "results.bed"), "utf-8");
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

it("write_file rejects path traversal outside allowed dir", async () => {
    const code = 'write_file("../tumor.bam", "malicious content")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/outside the allowed directory/);
});

it("write_file rejects denied .env paths before creating files", async () => {
    const fs = await import("node:fs/promises");
    const code = 'write_file(".env", "SECRET=hunter2")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not permitted/);
    const entries = await fs.readdir(allowedDir);
    expect(entries).not.toContain(".env");
});

it("write_file rejects denied .env.local paths before creating files", async () => {
    const fs = await import("node:fs/promises");
    const code = 'write_file(".env.local", "SECRET=hunter2")';
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not permitted/);
    const entries = await fs.readdir(allowedDir);
    expect(entries).not.toContain(".env.local");
});

it("write_file rejects path through symlinked directory pointing outside allowed dir", async () => {
    const outsideDir = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "outside-write-")),
    );
    await symlink(outsideDir, join(allowedDir, "link_outside_dir"));
    try {
        const code = 'write_file("link_outside_dir/evil.txt", "content")';
        const result = await runSandboxCode(code, allowedDir);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/outside the allowed directory/);
        // Verify no directory was created outside allowedDir
        const fs = await import("node:fs/promises");
        const outsideContents = await fs.readdir(outsideDir);
        expect(outsideContents).toHaveLength(0);
    } finally {
        await rm(outsideDir, { recursive: true });
    }
});

it("write_file supports nested paths with auto-created directories", async () => {
    const code = `
result = write_file("chr1/region_a/filtered.bed", "chr1\\t500\\t600\\n")
result
`;
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(true);
    const value = result.value as Record<string, unknown>;
    expect(value.path).toBe("chr1/region_a/filtered.bed");
    expect(value.bytes_written).toBeGreaterThan(0);
});

it("read_file can read back write_file output", async () => {
    const code = `
write_file("roundtrip.tsv", "read_id\\tlen\\nread1\\t1000\\n")
result = read_file("roundtrip.tsv")
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
    expect(result.value).toContain("visible.txt");
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

// --- continue_thinking external function ---

it("continue_thinking sets continueThinkingCalled flag", async () => {
    const result = await runSandboxCode(
        'continue_thinking()\nprint("hello")',
        allowedDir,
    );
    expect(result.success).toBe(true);
    expect(result.continueThinkingCalled).toBe(true);
});

it("continue_thinking works with print and expression value", async () => {
    const result = await runSandboxCode(
        'print("hello ")\ncontinue_thinking()\n1 + 1',
        allowedDir,
    );
    expect(result.success).toBe(true);
    expect(result.continueThinkingCalled).toBe(true);
    // Always use join("") for print assertions — printCallback fires
    // per-segment, not per-line, so joining reconstructs original output.
    expect(result.prints?.join("")).toContain("hello ");
    expect(result.value).toBe(2);
});

it("continue_thinking discards continueThinkingCalled on runtime error", async () => {
    // Use undefined_var (NameError) instead of 1/0 — Monty may not
    // raise ZeroDivisionError the same way CPython does.
    const result = await runSandboxCode(
        "continue_thinking()\nundefined_var",
        allowedDir,
    );
    expect(result.success).toBe(false);
    expect(result.continueThinkingCalled).toBeUndefined();
});

it("continue_thinking returns false when not called", async () => {
    const result = await runSandboxCode("1 + 1", allowedDir);
    expect(result.success).toBe(true);
    expect(result.continueThinkingCalled).toBe(false);
    expect(result.sandboxToolCalled).toBe(false);
});

it("records sandbox tool calls separately from continue_thinking", async () => {
    const result = await runSandboxCode("ls()", allowedDir);
    expect(result.success).toBe(true);
    expect(result.continueThinkingCalled).toBe(false);
    expect(result.sandboxToolCalled).toBe(true);
});

// --- wrapForMonty error conversion ---

it("wrapForMonty converts a non-Error throw to SandboxError", async () => {
    // f(0) re-throws a SandboxError as-is; f(1) wraps an Error; f(2) wraps a
    // plain string — the only branch (line 100) not covered by other tests.
    /**
     *
     * @param n
     */
    /**
     * Throws different error types depending on n: SandboxError (0), Error (1),
     * or a plain string (anything else).
     *
     * @param n - Selector for which throw type to use.
     */
    function f(n: number): Promise<void> {
        if (n === 0) throw new SandboxError("RuntimeError", "sandbox");
        if (n === 1) throw new Error("native");
        throw "plain string";
    }
    const wrapped = wrapForMonty({ f });
    await expect(wrapped.f(0)).rejects.toThrow("sandbox");
    await expect(wrapped.f(1)).rejects.toThrow("native");
    await expect(wrapped.f(2)).rejects.toThrow("plain string");
});

it("returns GenericError when sandbox setup throws a non-Monty error", async () => {
    // Use /dev/null/xyz so mkdirSync fails with ENOTDIR on both macOS and
    // Linux — even when the process runs as root (as in Linux CI containers),
    // /dev/null is a character device and cannot be entered as a directory.
    const result = await runSandboxCode("1+1", "/dev/null/xyz");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("GenericError");
});

// --- print() capture ---

it("captures print output in SandboxResult", async () => {
    const result = await runSandboxCode('print("hello")\n42', allowedDir);
    expect(result.success).toBe(true);
    expect(result.prints?.join("")).toContain("hello");
    expect(result.value).toBe(42);
});

it("captures multiple print calls", async () => {
    const result = await runSandboxCode(
        'print("a")\nprint("b")\n1',
        allowedDir,
    );
    expect(result.success).toBe(true);
    expect(result.prints?.join("")).toContain("a");
    expect(result.prints?.join("")).toContain("b");
});

it("returns empty prints array when print not called", async () => {
    const result = await runSandboxCode("1 + 1", allowedDir);
    expect(result.success).toBe(true);
    expect(result.prints).toEqual([]);
});

it("preserves prints on runtime error", async () => {
    const result = await runSandboxCode(
        'print("before")\nundefined_var',
        allowedDir,
    );
    expect(result.success).toBe(false);
    expect(result.prints?.join("")).toContain("before");
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

// --- Complete printed output delivery ---

it.each([
    false,
    true,
])("saves complete multi-call prints above 1 MiB, including before an error (%s)", async (fail) => {
    const result = await runSandboxCode(
        'for i in range(200):\n    print("x" * 10000)\nprint("END")\n' +
            (fail ? "undefined_var" : ""),
        allowedDir,
    );
    expect(result.success).toBe(!fail);
    const notice = result.prints?.join("") ?? "";
    const path = notice.match(/ai_chat_output\/python-prints-[\w-]+\.txt/)?.[0];
    expect(path).toBeDefined();
    expect(await readFile(join(allowedDir, path ?? ""), "utf-8")).toBe(
        `${`${"x".repeat(10000)}\n`.repeat(200)}END\n`,
    );
    const feedback = JSON.parse(
        buildExecutionFeedback(result, 2).replace(
            "Code execution result: ",
            "",
        ),
    );
    expect(feedback.prints).toBe(notice);
    expect(feedback).not.toHaveProperty("truncated");
    expect(notice).not.toContain("x".repeat(100));
});

it.each([
    0, 1,
])("delivers printed output at the inclusive 50 MiB ceiling plus %s bytes", async (extra) => {
    const before = await readdir(join(allowedDir, "ai_chat_output"));
    const result = await runSandboxCode(
        `print("x" * ${DEFAULT_MAX_WRITE_BYTES - 1}, end="")\nprint("Z", end="")\n` +
            (extra
                ? 'print("!", end="")\nwrite_file("overflow-side-effect.txt", "completed")'
                : ""),
        allowedDir,
        { maxDurationSecs: 30 },
    );
    expect(result.success).toBe(extra === 0);
    if (result.success) {
        const path = result.prints
            ?.join("")
            .match(/ai_chat_output\/python-prints-[\w-]+\.txt/)?.[0];
        expect(path).toBeDefined();
        const saved = await readFile(join(allowedDir, path ?? ""));
        expect(saved.byteLength).toBe(DEFAULT_MAX_WRITE_BYTES);
        expect(
            saved.equals(
                Buffer.from(`${"x".repeat(DEFAULT_MAX_WRITE_BYTES - 1)}Z`),
            ),
        ).toBe(true);
    } else {
        expect(result.errorType).toBe("OutputError");
        expect(result.message).toContain("50 MiB");
        expect(result.prints).toEqual([]);
        expect(await readdir(join(allowedDir, "ai_chat_output"))).toEqual(
            before,
        );
        expect(
            await readFile(
                join(allowedDir, "overflow-side-effect.txt"),
                "utf-8",
            ),
        ).toBe("completed");
    }
});

// --- Parity tests: runMontyAsyncWithPrint vs runMontyAsync ---

describe("runMontyAsyncWithPrint parity with runMontyAsync", () => {
    /**
     * Runs code through upstream runMontyAsync for parity comparison.
     *
     * @param code - The Python code to execute.
     * @returns The output value from upstream runMontyAsync.
     */
    async function runUpstream(code: string): Promise<unknown> {
        const { Monty } = await import("@pydantic/monty");
        const m = new Monty(code, {});
        return runMontyAsync(m, {});
    }

    it("simple expression: both return same value", async () => {
        const code = "1 + 1";
        const upstream = await runUpstream(code);
        const wrapped = await runSandboxCode(code, allowedDir);
        expect(wrapped.success).toBe(true);
        expect(wrapped.value).toBe(upstream);
    });

    it("external function call: both return same value", async () => {
        const code = `info = peek("${bamName}")\nlen(info["contigs"])`;
        // Upstream with external functions
        const { Monty } = await import("@pydantic/monty");
        const { peek } = await import("@nanalogue/node");
        const resolvedBam = join(allowedDir, bamName);
        const m = new Monty(code, { externalFunctions: ["peek"] });
        const upstream = await runMontyAsync(m, {
            /**
             * External functions for upstream parity test.
             */
            externalFunctions: {
                /**
                 * Peek implementation for parity test.
                 *
                 * @returns Peek result.
                 */
                peek: async () => peek({ bamPath: resolvedBam }),
            },
        });
        const wrapped = await runSandboxCode(code, allowedDir);
        expect(wrapped.success).toBe(true);
        expect(wrapped.value).toBe(upstream);
    });

    it("runtime error: both produce the same error", async () => {
        const code = "undefined_var";
        const { Monty, MontyRuntimeError } = await import("@pydantic/monty");
        const m = new Monty(code, {});
        let upstreamError: Error | undefined;
        try {
            await runMontyAsync(m, {});
        } catch (e) {
            upstreamError = e as Error;
        }
        expect(upstreamError).toBeInstanceOf(MontyRuntimeError);

        const wrapped = await runSandboxCode(code, allowedDir);
        expect(wrapped.success).toBe(false);
        expect(wrapped.errorType).toBe("RuntimeError");
    });

    it("additionally captures print output", async () => {
        const code = 'print("parity test")\n42';
        const upstream = await runUpstream(code);
        const wrapped = await runSandboxCode(code, allowedDir);
        expect(wrapped.success).toBe(true);
        // Same expression value
        expect(wrapped.value).toBe(upstream);
        // But also captures print output (upstream does not)
        expect(wrapped.prints?.join("")).toContain("parity test");
    });
});

// --- collectTerminalOutput ---

it("collectTerminalOutput uses safeStringify fallback for non-serializable values", () => {
    // BigInt cannot be JSON-serialised, so safeStringify returns ok: false,
    // exercising the valStr.fallback branch in collectTerminalOutput.
    const result = collectTerminalOutput({
        success: true,
        endedWithExpression: true,
        value: BigInt(42),
        continueThinkingCalled: false,
        sandboxToolCalled: false,
        prints: [],
        truncated: false,
    });
    expect(result).toContain("cyclic or non-serializable");
});

it("collectTerminalOutput joins prints with serialized expression value", () => {
    const result = collectTerminalOutput({
        success: true,
        endedWithExpression: true,
        value: 99,
        continueThinkingCalled: false,
        sandboxToolCalled: false,
        prints: ["hello\n"],
        truncated: false,
    });
    expect(result).toBe("hello\n99\n");
});

// --- removedTools ---

it("removedTools prevents a removed tool from being called", async () => {
    const result = await runSandboxCode("peek('nonexistent.bam')", allowedDir, {
        removedTools: new Set(["peek"]),
    });
    expect(result.success).toBe(false);
});

it("removedTools does not affect tools that are not removed", async () => {
    const result = await runSandboxCode("ls()", allowedDir, {
        removedTools: new Set(["peek"]),
    });
    expect(result.success).toBe(true);
});

it("removedTools with empty set leaves all tools available", async () => {
    const result = await runSandboxCode("ls()", allowedDir, {
        removedTools: new Set(),
    });
    expect(result.success).toBe(true);
});

// --- Printed UTF-8 byte boundary ---

it.each([
    6, 5, 4,
])("shares an inline allowance of %s bytes without prematurely spilling small mixed output", async (maxOutputBytes) => {
    const result = await runSandboxCode('print("ok")\n42', allowedDir, {
        maxOutputBytes,
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
    const output = result.prints?.join("") ?? "";
    if (maxOutputBytes >= 5) {
        expect(output).toBe("ok\n");
    } else {
        const path = output.match(
            /ai_chat_output\/python-prints-[\w-]+\.txt/,
        )?.[0];
        expect(path).toBeDefined();
        expect(await readFile(join(allowedDir, path ?? ""), "utf-8")).toBe(
            "ok\n",
        );
    }
});

it.each([
    5, 4,
])("delivers complete emoji prints with an inline allowance of %s bytes", async (maxOutputBytes) => {
    const result = await runSandboxCode('print("🎉")', allowedDir, {
        maxOutputBytes,
    });
    expect(result.success).toBe(true);
    const output = result.prints?.join("") ?? "";
    if (maxOutputBytes === 5) {
        expect(output).toBe("🎉\n");
    } else {
        const path = output.match(
            /ai_chat_output\/python-prints-[\w-]+\.txt/,
        )?.[0];
        expect(path).toBeDefined();
        expect(await readFile(join(allowedDir, path ?? ""), "utf-8")).toBe(
            "🎉\n",
        );
    }
});

// RuntimeError message includes a full Python-style traceback so the LLM can
// see exactly which line failed and what the source looked like.
it("runtime error message includes traceback with line number and source preview", async () => {
    // Line 1 succeeds; line 2 raises TypeError (int + str).
    const code = "x = 1\ny = x + 'oops'";
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("RuntimeError");
    // Full traceback header and the failing line number must be present.
    expect(result.message).toContain("Traceback (most recent call last):");
    expect(result.message).toContain("line 2");
    // The source preview of the failing expression must appear.
    expect(result.message).toContain("x + 'oops'");
});

// When an external function raises, the traceback should include the Python
// call site (the line in the LLM-generated script that invoked the function),
// not just a bare error message.
it("external function error message includes the Python call site in the traceback", async () => {
    // Line 1 is harmless; line 2 calls peek() with a nonexistent file so the
    // external function throws, and Monty should attach line 2 as the frame.
    const code = "x = 1\npeek('nonexistent.bam')";
    const result = await runSandboxCode(code, allowedDir);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("RuntimeError");
    expect(result.message).toContain("Traceback (most recent call last):");
    expect(result.message).toContain("line 2");
    expect(result.message).toContain("peek");
});
