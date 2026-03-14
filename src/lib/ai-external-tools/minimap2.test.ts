// Tests for the minimap2 external tool.
// Covers all input-validation branches (no WASM needed) plus a full
// alignment integration test using the sample FASTA files in tests/data/.

import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeRunMinimap2 } from "./minimap2";

/** Shape of the dict returned by the minimap2() tool. */
interface Minimap2Result {
    /** PAF alignment output (one record per line, tab-separated). */
    paf: string;
    /** Minimap2 progress and log messages from stderr. */
    stderr: string;
}

/** Absolute path to the tests/data directory. */
const TEST_DATA_DIR = resolve(__dirname, "../../../tests/data");

let allowedDir: string;
let minimap2: ReturnType<typeof makeRunMinimap2>;

beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "minimap2-tool-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);

    // Copy sample FASTA files into the allowed directory.
    const { readFile } = await import("node:fs/promises");
    await writeFile(
        join(allowedDir, "contigs.fa"),
        await readFile(join(TEST_DATA_DIR, "sample_contigs.fa")),
    );
    await writeFile(
        join(allowedDir, "query.fa"),
        await readFile(join(TEST_DATA_DIR, "sample_query.fa")),
    );

    // Sensitive files for deny-list tests.
    await writeFile(join(allowedDir, ".env"), "SECRET=test");
    await writeFile(join(allowedDir, "id_rsa"), "PRIVATE KEY DATA");

    // A file just over the 20 MB cap for size-limit tests.
    await writeFile(
        join(allowedDir, "big.fa"),
        Buffer.alloc(20 * 1024 * 1024 + 1, 65 /* 'A' */),
    );

    minimap2 = makeRunMinimap2(allowedDir);
}, 30_000);

afterAll(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- Type validation ---

it("rejects non-string reference_path", async () => {
    await expect(
        minimap2(123 as unknown as string, "query.fa"),
    ).rejects.toMatchObject({
        name: "TypeError",
        message: expect.stringContaining("reference_path must be a string"),
    });
});

it("rejects non-string query_path", async () => {
    await expect(
        minimap2("contigs.fa", 456 as unknown as string),
    ).rejects.toMatchObject({
        name: "TypeError",
        message: expect.stringContaining("query_path must be a string"),
    });
});

it("rejects non-string preset", async () => {
    await expect(
        minimap2("contigs.fa", "query.fa", { preset: 99 }),
    ).rejects.toMatchObject({
        name: "TypeError",
        message: expect.stringContaining("preset must be a string"),
    });
});

it("rejects unknown preset string", async () => {
    await expect(
        minimap2("contigs.fa", "query.fa", { preset: "not-a-preset" }),
    ).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringContaining("unknown preset"),
    });
});

it("rejects unknown preset passed positionally as a bare string", async () => {
    await expect(
        minimap2("contigs.fa", "query.fa", "not-a-preset"),
    ).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringContaining("unknown preset"),
    });
});

it("rejects a non-string non-object third argument (e.g. integer)", async () => {
    await expect(
        minimap2("contigs.fa", "query.fa", 123 as unknown as string),
    ).rejects.toMatchObject({
        name: "TypeError",
        message: expect.stringContaining("third argument"),
    });
});

it("rejects an array as the third argument", async () => {
    await expect(
        minimap2("contigs.fa", "query.fa", ["sr"] as unknown as string),
    ).rejects.toMatchObject({
        name: "TypeError",
        message: expect.stringContaining("third argument"),
    });
});

// --- Path security ---

it("rejects reference path outside allowedDir", async () => {
    await expect(minimap2("../../etc/passwd", "query.fa")).rejects.toThrow();
});

it("rejects query path outside allowedDir", async () => {
    await expect(minimap2("contigs.fa", "../../etc/passwd")).rejects.toThrow();
});

it("rejects reference on the sensitive-file deny list", async () => {
    await expect(minimap2(".env", "query.fa")).rejects.toMatchObject({
        name: "OSError",
    });
});

it("rejects query on the sensitive-file deny list", async () => {
    await expect(minimap2("contigs.fa", "id_rsa")).rejects.toMatchObject({
        name: "OSError",
    });
});

it("rejects a symlink reference that escapes allowedDir", async () => {
    const link = join(allowedDir, "escape_ref.fa");
    await symlink("/etc/passwd", link);
    await expect(minimap2("escape_ref.fa", "query.fa")).rejects.toThrow();
});

it("rejects a symlink query that escapes allowedDir", async () => {
    const link = join(allowedDir, "escape_query.fa");
    await symlink("/etc/passwd", link);
    await expect(minimap2("contigs.fa", "escape_query.fa")).rejects.toThrow();
});

// --- File size cap ---

it("rejects reference file exceeding the 20 MB cap", async () => {
    await expect(minimap2("big.fa", "query.fa")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringContaining("exceeds the 20 MB limit"),
    });
});

it("rejects query file exceeding the 20 MB cap", async () => {
    await expect(minimap2("contigs.fa", "big.fa")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringContaining("exceeds the 20 MB limit"),
    });
});

// --- XHR stub error path ---

it("XHR stub calls onerror when the target file does not exist", async () => {
    // The stub is installed on global.XMLHttpRequest by minimap2.ts at
    // module load time. Access it directly to test the error branch in send().
    /** Minimal shape of the XHR stub installed by minimap2.ts. */
    interface XhrStubShape {
        /** Records the URL for the pending request. */
        open(method: string, url: string): void;
        /** Initiates the asynchronous file read. */
        send(): void;
        /** Called when the file read fails. */
        onerror?: (e: unknown) => void;
        /** HTTP-style status code set by the stub (0 on error). */
        status: number;
    }
    const XhrStub = (global as Record<string, unknown>)
        .XMLHttpRequest as new () => XhrStubShape;
    const xhr = new XhrStub();
    xhr.open("GET", "file:///nonexistent/path/does/not/exist.data");
    await new Promise<void>((resolve) => {
        /**
         * Verifies the stub sets status to 0 and forwards the error object.
         *
         * @param e - The error passed by the send() catch block.
         */
        xhr.onerror = (e) => {
            expect(xhr.status).toBe(0);
            expect(e).toBeTruthy();
            resolve();
        };
        xhr.send();
    });
});

// --- Successful alignment ---

it("returns PAF output for a known mapping with the sr preset", async () => {
    const result = (await minimap2("contigs.fa", "query.fa", {
        preset: "sr",
    })) as Minimap2Result;

    expect(typeof result.paf).toBe("string");
    expect(typeof result.stderr).toBe("string");

    // The query read is a substring of dummyIII — it must map there.
    const lines = result.paf.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const fields = lines[0].split("\t");
    expect(fields[0]).toBe("a4f36092-b4d5-47a9-813e-c22c3b477a0c");
    expect(fields[4]).toBe("+"); // forward strand
    expect(fields[5]).toBe("dummyIII"); // target contig
    expect(parseInt(fields[11], 10)).toBeGreaterThan(0); // mapq > 0

    // stderr should contain minimap2's standard progress output.
    expect(result.stderr).toContain("[M::main]");
}, 60_000);

it("accepts preset passed as a positional string argument", async () => {
    const result = (await minimap2(
        "contigs.fa",
        "query.fa",
        "sr",
    )) as Minimap2Result;
    expect(typeof result.paf).toBe("string");
    const lines = result.paf.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
}, 60_000);

it("returns PAF output without a preset (minimap2 default settings)", async () => {
    const result = (await minimap2("contigs.fa", "query.fa")) as Minimap2Result;

    expect(typeof result.paf).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(result.stderr).toContain("[M::main]");
}, 60_000);
