// Integration tests for the ai-external-tools factory functions.
// Calls each factory directly (not through runSandboxCode) against real on-the-fly
// BAM files generated with simulateModBam, following the same pattern as
// monty-sandbox.test.ts.

import {
    chmod,
    link,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { simulateModBam } from "@nanalogue/node";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { MAX_FILENAME_LENGTH } from "../ai-chat-constants";
import { SandboxError } from "../monty-sandbox-helpers";
import { makeLs } from "./ls";
import { makeReadFile } from "./read-file";
import { makeWindowReads } from "./window-reads";
import { makeWriteFile, resetSessionWrittenFiles } from "./write-file";

let allowedDir: string;
let bamName: string;

beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ai-ext-tools-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);
    const configPath = resolve(
        __dirname,
        "../../../tests/data/simulation_configs/simple_bam.json",
    );
    const config = await readFile(configPath, "utf-8");
    bamName = "simple_test.bam";
    await simulateModBam({
        jsonConfig: config,
        bamPath: join(allowedDir, bamName),
        fastaPath: join(allowedDir, "simple_test.fasta"),
    });
}, 60_000);

// The session's written-file set is module-level; clear it so tests that
// reuse a file name do not depend on test order.
beforeEach(() => {
    resetSessionWrittenFiles();
});

afterAll(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- makeWindowReads ---

it("makeWindowReads returns an array of records for a real BAM file", async () => {
    const fn = makeWindowReads(allowedDir, 1_000);
    const result = await fn(bamName, { win: 100, step: 50 });
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThan(0);
});

// --- makeLs ---

it("makeLs returns a plain array when under the cap", async () => {
    const fn = makeLs(allowedDir, 10);
    const result = await fn();
    expect(Array.isArray(result)).toBe(true);
});

it("makeLs supports every documented glob shape", async () => {
    await mkdir(join(allowedDir, "sample_001", "run"), { recursive: true });
    await mkdir(join(allowedDir, "run_A", "alignments", "deeper"), {
        recursive: true,
    });
    await Promise.all([
        writeFile(join(allowedDir, "sample_001", "direct.bam"), ""),
        writeFile(join(allowedDir, "sample_001", "run", "deep.bam"), ""),
        writeFile(join(allowedDir, "run_A", "alignments", "direct.bam"), ""),
        writeFile(
            join(allowedDir, "run_A", "alignments", "deeper", "deep.bam"),
            "",
        ),
    ]);
    const fn = makeLs(allowedDir, 20);

    await expect(fn("*.bam")).resolves.toEqual([bamName]);
    const sampleFiles = (await fn("sample_001/**/*.bam")) as string[];
    expect(sampleFiles).toHaveLength(2);
    expect(sampleFiles).toEqual(
        expect.arrayContaining([
            "sample_001/direct.bam",
            "sample_001/run/deep.bam",
        ]),
    );
    await expect(fn("run_A/alignments/*.bam")).resolves.toEqual([
        "run_A/alignments/direct.bam",
    ]);
    const allBamFiles = (await fn("**/*.bam")) as string[];
    expect(allBamFiles).toHaveLength(5);
    expect(allBamFiles).toEqual(
        expect.arrayContaining([
            bamName,
            "sample_001/direct.bam",
            "sample_001/run/deep.bam",
            "run_A/alignments/direct.bam",
            "run_A/alignments/deeper/deep.bam",
        ]),
    );
});

it("makeLs validates globs before traversal, including empty directories", async () => {
    const emptyDir = await mkdtemp(join(allowedDir, "empty-glob-"));
    for (const root of [emptyDir, join(emptyDir, "does-not-exist")]) {
        const fn = makeLs(root);
        for (const pattern of ["{1..1000000000}", "@(a|b)", "a".repeat(1025)]) {
            await expect(fn(pattern)).rejects.toMatchObject({
                name: "ValueError",
            });
        }
    }
    await expect(makeLs(emptyDir)("**/*.bam")).resolves.toEqual([]);
});

it("makeLs keeps hidden-file matching separate from sensitive-file exclusion", async () => {
    const root = await mkdtemp(join(allowedDir, "hidden-glob-"));
    await mkdir(join(root, ".cache"));
    for (const file of [
        "visible.bam",
        ".hidden.bam",
        ".cache/sample.bam",
        ".env",
        "private.pem",
    ]) {
        await writeFile(join(root, file), "");
    }
    const fn = makeLs(root);
    await expect(fn("**/*.bam")).resolves.toEqual(["visible.bam"]);
    await expect(fn(".cache/*.bam")).resolves.toEqual([".cache/sample.bam"]);
    await expect(fn(".*.bam")).resolves.toEqual([".hidden.bam"]);
    await expect(fn(".env")).resolves.toEqual([]);
    await expect(fn("**/*.pem")).resolves.toEqual([]);
    for (const pattern of [undefined, ""]) {
        const files = (await fn(pattern)) as string[];
        expect(files.sort()).toEqual([
            ".cache/sample.bam",
            ".hidden.bam",
            "visible.bam",
        ]);
    }
});

it("makeLs throws SandboxError when file count exceeds maxEntries", async () => {
    // Use a small cap so we don't need to create thousands of files.
    const capDir = join(allowedDir, "cap_test");
    await mkdir(capDir, { recursive: true });
    await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
            import("node:fs/promises").then((fs) =>
                fs.writeFile(join(capDir, `f${i}.txt`), ""),
            ),
        ),
    );
    const fn = makeLs(allowedDir, 3);
    await expect(fn()).rejects.toMatchObject({
        name: "ValueError",
        message: /capped at 3 entries/,
    });
});

// --- makeWriteFile ---

it("makeWriteFile rejects a filename component longer than MAX_FILENAME_LENGTH", async () => {
    const longName = "a".repeat(MAX_FILENAME_LENGTH + 1);
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn(longName, "content")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/exceeds.*character limit/),
    });
});

it("makeWriteFile rejects a filename component containing control characters", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("file\x00name.txt", "content")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/control characters/),
    });
});

it("makeWriteFile rejects content that exceeds maxWriteBytes", async () => {
    const fn = makeWriteFile(allowedDir, 10);
    await expect(fn("big.txt", "x".repeat(100))).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/exceeds write limit/),
    });
    // Verify no file was created.
    await expect(
        import("node:fs/promises").then((fs) =>
            fs.access(join(allowedDir, "big.txt")),
        ),
    ).rejects.toThrow();
});

it("makeWriteFile throws SandboxError (not plain Error) for all guard failures", async () => {
    const fn = makeWriteFile(allowedDir, 10);
    let err: unknown;
    try {
        await fn("x".repeat(MAX_FILENAME_LENGTH + 1), "");
    } catch (e) {
        err = e;
    }
    expect(err).toBeInstanceOf(SandboxError);
});

it("makeWriteFile atomically rejects concurrent creation of the same file", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    const contents = ["first", "second"];
    const results = await Promise.allSettled([
        fn("concurrent.txt", contents[0]),
        fn("concurrent.txt", contents[1]),
    ]);

    expect(
        results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
        results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
        results.find((result) => result.status === "rejected"),
    ).toMatchObject({
        reason: {
            name: "FileExistsError",
            message: expect.stringContaining("already exists"),
        },
    });
    const successfulIndex = results.findIndex(
        (result) => result.status === "fulfilled",
    );
    await expect(
        readFile(join(allowedDir, "concurrent.txt"), "utf-8"),
    ).resolves.toBe(contents[successfulIndex]);
});

it("makeWriteFile overwrites a file it wrote earlier in the session, by any spelling of its path", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("session.tsv", "first")).resolves.toEqual({
        path: "session.tsv",
        bytes_written: 5,
    });
    await expect(fn("./session.tsv", "second!")).resolves.toEqual({
        path: "./session.tsv",
        bytes_written: 7,
        overwrote: true,
    });
    await expect(
        readFile(join(allowedDir, "session.tsv"), "utf-8"),
    ).resolves.toBe("second!");
});

it("makeWriteFile overwrites its own file under a symlinked folder", async () => {
    await mkdir(join(allowedDir, "real_folder"), { recursive: true });
    await symlink(
        join(allowedDir, "real_folder"),
        join(allowedDir, "linked_folder"),
    );
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await fn("linked_folder/a.txt", "one");
    await expect(fn("linked_folder/a.txt", "two")).resolves.toMatchObject({
        overwrote: true,
    });
    await expect(
        readFile(join(allowedDir, "real_folder", "a.txt"), "utf-8"),
    ).resolves.toBe("two");
});

it("makeWriteFile overwrite replaces the file, leaving a hard link to the old one unchanged", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await fn("linked_out.txt", "model v1");
    await link(
        join(allowedDir, "linked_out.txt"),
        join(allowedDir, "user_snapshot.txt"),
    );
    await fn("linked_out.txt", "model v2");
    await expect(
        readFile(join(allowedDir, "user_snapshot.txt"), "utf-8"),
    ).resolves.toBe("model v1");
    await expect(
        readFile(join(allowedDir, "linked_out.txt"), "utf-8"),
    ).resolves.toBe("model v2");
});

it("makeWriteFile refuses to overwrite a session file the user made read-only", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await fn("locked.tsv", "model v1");
    await chmod(join(allowedDir, "locked.tsv"), 0o444);
    await expect(fn("locked.tsv", "model v2")).rejects.toMatchObject({
        name: "OSError",
        message:
            'write_file: "locked.tsv" has been made read-only, so it was not ' +
            'changed. Write to a new name instead, e.g. "locked-v2.tsv" (currently free).',
    });
    await expect(
        readFile(join(allowedDir, "locked.tsv"), "utf-8"),
    ).resolves.toBe("model v1");
});

// Windows keeps only a read-only flag, not the full permission bits.
it.skipIf(process.platform === "win32")(
    "makeWriteFile keeps the old file's permissions when overwriting",
    async () => {
        const fn = makeWriteFile(allowedDir, 1024 * 1024);
        await fn("shared.tsv", "model v1");
        await chmod(join(allowedDir, "shared.tsv"), 0o640);
        await fn("shared.tsv", "model v2");
        expect((await stat(join(allowedDir, "shared.tsv"))).mode & 0o777).toBe(
            0o640,
        );
    },
);

it("makeWriteFile does not report overwrote when its earlier file was deleted", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await fn("deleted_later.txt", "first");
    await rm(join(allowedDir, "deleted_later.txt"));
    await expect(fn("deleted_later.txt", "second")).resolves.toEqual({
        path: "deleted_later.txt",
        bytes_written: 6,
    });
});

it("makeWriteFile removes its temporary file when a replacement fails", async () => {
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await mkdir(join(allowedDir, "replace_dir"), { recursive: true });
    await fn("replace_dir/target", "first");
    // The user swaps the model's file for a folder, so the rename fails.
    await rm(join(allowedDir, "replace_dir", "target"));
    await mkdir(join(allowedDir, "replace_dir", "target", "inner"), {
        recursive: true,
    });
    await expect(fn("replace_dir/target", "second")).rejects.toMatchObject({
        name: "OSError",
        message: expect.stringMatching(
            /^write_file: could not replace "replace_dir\/target" \((EISDIR|ENOTEMPTY|EPERM)\)$/,
        ),
    });
    await expect(readdir(join(allowedDir, "replace_dir"))).resolves.toEqual([
        "target",
    ]);
});

it("makeWriteFile with its own list overwrites only its own files and leaves them protected from the chat", async () => {
    const execRun = makeWriteFile(
        allowedDir,
        1024 * 1024,
        "write_file",
        new Set<string>(),
    );
    await execRun("exec_output.txt", "draft");
    await expect(
        execRun("exec_output.txt", "user result"),
    ).resolves.toMatchObject({ overwrote: true });

    const chatRun = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(
        chatRun("exec_output.txt", "model result"),
    ).rejects.toMatchObject({
        name: "FileExistsError",
        message: expect.stringContaining(
            "was not written by the current chat or script",
        ),
    });
    await chatRun("chat_output.txt", "model result");
    await expect(
        execRun("chat_output.txt", "user overwrite"),
    ).rejects.toMatchObject({
        name: "FileExistsError",
        message: expect.stringContaining(
            "was not written by the current chat or script",
        ),
    });
});

it("makeWriteFile never overwrites a file the session did not write", async () => {
    await writeFile(join(allowedDir, "users_own.tsv"), "user data");
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    // Writing some other file must not unlock the user's file.
    await fn("unrelated_session_file.tsv", "x");
    await expect(fn("users_own.tsv", "model data")).rejects.toMatchObject({
        name: "FileExistsError",
    });
    await expect(
        readFile(join(allowedDir, "users_own.tsv"), "utf-8"),
    ).resolves.toBe("user data");
});

it("resetSessionWrittenFiles keeps a run still going from the old chat from unlocking files in the new chat", async () => {
    // Each run makes its writer when it starts, before New Chat resets.
    const oldChatRun = makeWriteFile(allowedDir, 1024 * 1024);
    resetSessionWrittenFiles();
    await oldChatRun("late_old_chat.tsv", "old chat");
    const newChatRun = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(
        newChatRun("late_old_chat.tsv", "new chat"),
    ).rejects.toMatchObject({ name: "FileExistsError" });
    await expect(
        readFile(join(allowedDir, "late_old_chat.tsv"), "utf-8"),
    ).resolves.toBe("old chat");
});

it("resetSessionWrittenFiles protects the session's earlier files again", async () => {
    await makeWriteFile(allowedDir, 1024 * 1024)("before_reset.tsv", "first");
    resetSessionWrittenFiles();
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("before_reset.tsv", "second")).rejects.toMatchObject({
        name: "FileExistsError",
    });
});

it("makeWriteFile collision names write_file, keeps the file, and suggests a free name", async () => {
    await writeFile(join(allowedDir, "dup.bed"), "original");
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("dup.bed", "new")).rejects.toMatchObject({
        name: "FileExistsError",
        message: expect.stringMatching(
            /^write_file: "dup\.bed" already exists and was not written by the current chat or script \(it may be the user's file, or from an earlier chat or script\), so it is read-only and was not changed\. Files cannot be deleted\. Write to a new name instead, e\.g\. "dup-v2\.bed" \(currently free\)\.$/,
        ),
    });
    await expect(readFile(join(allowedDir, "dup.bed"), "utf-8")).resolves.toBe(
        "original",
    );
});

it("makeWriteFile collision suggestion skips taken numbers instead of stacking suffixes", async () => {
    await writeFile(join(allowedDir, "taken.tsv"), "");
    await writeFile(join(allowedDir, "taken-v2.tsv"), "");
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("taken.tsv", "x")).rejects.toMatchObject({
        message: expect.stringContaining('e.g. "taken-v3.tsv"'),
    });
    await expect(fn("taken-v2.tsv", "x")).rejects.toMatchObject({
        message: expect.stringContaining('e.g. "taken-v3.tsv"'),
    });
});

it("makeWriteFile collision omits the suggestion when every versioned name is taken", async () => {
    await mkdir(join(allowedDir, "full_dir"), { recursive: true });
    await writeFile(join(allowedDir, "full_dir", "full.txt"), "");
    for (let n = 2; n <= 101; n++) {
        await writeFile(join(allowedDir, "full_dir", `full-v${n}.txt`), "");
    }
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    const error = await fn("full_dir/full.txt", "x").catch((e: unknown) => e);
    expect(error).toMatchObject({
        name: "FileExistsError",
        message: expect.stringMatching(/Write to a new name instead\.$/),
    });
    expect((error as Error).message).not.toContain("e.g.");
});

it.each([
    // A number that means something is kept, not counted up.
    ["region_1.bed", "region_1-v2.bed"],
    ["n-v12345678901234567890.txt", "n-v12345678901234567890-v2.txt"],
    ["trailing.", "trailing-v2."],
])("makeWriteFile collision on %s suggests %s", async (name, expected) => {
    await writeFile(join(allowedDir, name), "");
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn(name, "x")).rejects.toMatchObject({
        message: expect.stringContaining(`e.g. "${expected}"`),
    });
});

it.skipIf(sep === "\\")(
    "makeWriteFile collision treats a backslash as part of the file name outside Windows",
    async () => {
        await writeFile(join(allowedDir, "back\\slash.txt"), "");
        const fn = makeWriteFile(allowedDir, 1024 * 1024);
        await expect(fn("back\\slash.txt", "x")).rejects.toMatchObject({
            message: expect.stringContaining('e.g. "back\\slash-v2.txt"'),
        });
    },
);

it("makeWriteFile collision suggestion keeps the directory and a .vcf.gz extension", async () => {
    await mkdir(join(allowedDir, "calls_dir"), { recursive: true });
    await writeFile(join(allowedDir, "calls_dir", "calls.vcf.gz"), "");
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("calls_dir/calls.vcf.gz", "x")).rejects.toMatchObject({
        message: expect.stringContaining('e.g. "calls_dir/calls-v2.vcf.gz"'),
    });
});

it("makeWriteFile collision on an existing folder written with a trailing slash omits the suggestion", async () => {
    await mkdir(join(allowedDir, "slash_dir"), { recursive: true });
    const fn = makeWriteFile(allowedDir, 1024 * 1024);
    await expect(fn("slash_dir/", "x")).rejects.toMatchObject({
        name: "FileExistsError",
        message: expect.stringMatching(/Write to a new name instead\.$/),
    });
});

// --- makeReadFile ---

it("makeReadFile rejects .svg files with ValueError", async () => {
    // Write a dummy SVG so the path exists; the extension check fires before
    // any filesystem access, but we want to ensure it is not bypassed for
    // existing files either.
    await writeFile(join(allowedDir, "plot.svg"), "<svg/>");
    const fn = makeReadFile(allowedDir, 1024 * 1024);
    await expect(fn("plot.svg")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/Cannot read SVG files/),
    });
});

it("makeReadFile rejects .SVG (uppercase) with ValueError", async () => {
    await writeFile(join(allowedDir, "CHART.SVG"), "<svg/>");
    const fn = makeReadFile(allowedDir, 1024 * 1024);
    await expect(fn("CHART.SVG")).rejects.toMatchObject({
        name: "ValueError",
    });
});

it("makeReadFile stops decompressing .gz input once the page is full", async () => {
    // 4 MiB of zeros compresses to a few KiB, like a small gzip bomb. The junk
    // after it is only reached, and only raises, if decompression runs past
    // the requested page.
    await writeFile(
        join(allowedDir, "expands.txt.gz"),
        Buffer.concat([
            gzipSync(Buffer.alloc(4 * 1024 * 1024)),
            Buffer.from("junk after the gzip data"),
        ]),
    );
    const fn = makeReadFile(allowedDir, 1024);
    await expect(fn("expands.txt.gz")).resolves.toEqual({
        content: "\0".repeat(1024),
        bytes_read: 1024,
        total_size: null,
        offset: 0,
    });
    await expect(
        fn("expands.txt.gz", { offset: 4 * 1024 * 1024 }),
    ).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/not valid gzip data/),
    });
});

it("makeReadFile ignores zero padding after .gz data", async () => {
    // Block-padded copies end in zero bytes; unlike other trailing data,
    // gzip -d accepts them silently, and read_file must too.
    const text = "chr1\t100\tA\tT\nchr2\t200\tG\tC\n";
    await writeFile(
        join(allowedDir, "padded.vcf.gz"),
        Buffer.concat([gzipSync(text), Buffer.alloc(512)]),
    );
    const fn = makeReadFile(allowedDir, 1024);
    await expect(fn("padded.vcf.gz")).resolves.toEqual({
        content: text,
        bytes_read: text.length,
        total_size: null,
        offset: 0,
    });
});

it("makeReadFile rejects non-zero padding after .gz data", async () => {
    // Non-zero trailing bytes mean a damaged file, so a read that reaches
    // them raises, where gzip -d warns and ignores them.
    const text = "chr1\t100\tA\tT\nchr2\t200\tG\tC\n";
    await writeFile(
        join(allowedDir, "nonzero-padded.vcf.gz"),
        Buffer.concat([gzipSync(text), Buffer.alloc(512, 1)]),
    );
    const fn = makeReadFile(allowedDir, 1024);
    await expect(fn("nonzero-padded.vcf.gz")).rejects.toMatchObject({
        name: "ValueError",
        message: expect.stringMatching(/not valid gzip data/),
    });
});

it("makeReadFile passes file-system errors on .gz paths through unchanged", async () => {
    // Only zlib errors become "not valid gzip data"; an I/O error keeps its code.
    await mkdir(join(allowedDir, "folder.gz"));
    const fn = makeReadFile(allowedDir, 1024);
    await expect(fn("folder.gz")).rejects.toMatchObject({ code: "EISDIR" });
});
