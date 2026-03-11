// Tests for the bash external tool: deny-list enforcement and basic behaviour.

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeBash } from "./bash";

/** Convenience type for the dict returned by the bash() tool. */
interface BashResult {
    /** Standard output produced by the command. */
    stdout: string;
    /** Standard error produced by the command. */
    stderr: string;
    /** Exit code of the process (0 = success). */
    exit_code: number;
}

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

let allowedDir: string;
let bash: (command: string) => Promise<unknown>;

beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "bash-tool-test-"));
    // Resolve symlinks so macOS /var → /private/var matches real paths.
    allowedDir = await realpath(raw);

    await writeFile(join(allowedDir, "data.txt"), "hello world");
    await writeFile(join(allowedDir, ".env"), "SECRET=hunter2");
    await writeFile(join(allowedDir, ".env.production"), "DB_PASS=s3cr3t");
    await writeFile(
        join(allowedDir, "cert.pem"),
        "-----BEGIN CERTIFICATE-----",
    );
    await writeFile(
        join(allowedDir, "id_rsa"),
        "-----BEGIN RSA PRIVATE KEY-----",
    );
    await mkdir(join(allowedDir, "subdir"));
    await writeFile(join(allowedDir, "subdir", ".env"), "NESTED_SECRET=abc");
    await writeFile(join(allowedDir, "subdir", "data.tsv"), "col1\tcol2\n");

    bash = makeBash(allowedDir, TIMEOUT_MS, MAX_OUTPUT_BYTES);
});

afterEach(async () => {
    await rm(allowedDir, { recursive: true });
});

// --- deny list enforcement ---

describe("deny list enforcement", () => {
    it("blocks cat on .env and does not leak its content", async () => {
        const r = (await bash(`cat ${allowedDir}/.env`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("SECRET");
        expect(r.stdout).not.toContain("hunter2");
    });

    it("blocks cat on .env.production", async () => {
        const r = (await bash(
            `cat ${allowedDir}/.env.production`,
        )) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("DB_PASS");
    });

    it("blocks cat on *.pem files", async () => {
        const r = (await bash(`cat ${allowedDir}/cert.pem`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("BEGIN CERTIFICATE");
    });

    it("blocks cat on id_rsa", async () => {
        const r = (await bash(`cat ${allowedDir}/id_rsa`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("BEGIN RSA");
    });

    it("blocks cat on a nested .env", async () => {
        const r = (await bash(`cat ${allowedDir}/subdir/.env`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("NESTED_SECRET");
    });

    it("allows cat on a normal file", async () => {
        const r = (await bash(`cat ${allowedDir}/data.txt`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).toContain("hello world");
    });

    it("allows cat on a normal file in a subdirectory", async () => {
        const r = (await bash(
            `cat ${allowedDir}/subdir/data.tsv`,
        )) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).toContain("col1");
    });

    it("blocks grep reading a .env file", async () => {
        const r = (await bash(`grep SECRET ${allowedDir}/.env`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("hunter2");
    });

    it("blocks head reading a .pem file", async () => {
        const r = (await bash(`head ${allowedDir}/cert.pem`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("BEGIN CERTIFICATE");
    });

    it("blocks base64 encoding a .env file (readFileBuffer deny path)", async () => {
        // base64 uses readFileBuffer internally; verify the deny list fires for
        // that code path as well as for the readFile path tested above.
        const r = (await bash(`base64 ${allowedDir}/.env`)) as BashResult;
        expect(r.exit_code).not.toBe(0);
        expect(r.stdout).not.toContain("SECRET");
    });

    it("hides .env from ls output", async () => {
        const r = (await bash(`ls -a ${allowedDir}`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).not.toContain(".env");
        expect(r.stdout).toContain("data.txt");
    });

    it("hides .env from find output", async () => {
        const r = (await bash(`find ${allowedDir} -maxdepth 1`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).not.toContain(".env");
        expect(r.stdout).toContain("data.txt");
    });

    it("hides id_rsa from ls output", async () => {
        const r = (await bash(`ls -a ${allowedDir}`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).not.toContain("id_rsa");
    });

    it("hides nested .env from ls on subdirectory", async () => {
        const r = (await bash(`ls -a ${allowedDir}/subdir`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).not.toContain(".env");
        expect(r.stdout).toContain("data.tsv");
    });
});

// --- basic functionality ---

describe("basic functionality", () => {
    it("returns stdout, stderr and exit_code", async () => {
        const r = (await bash("echo hello")) as BashResult;
        expect(r.stdout).toBe("hello\n");
        expect(r.stderr).toBe("");
        expect(r.exit_code).toBe(0);
    });

    it("captures non-zero exit code", async () => {
        const r = (await bash("exit 42")) as BashResult;
        expect(r.exit_code).toBe(42);
    });

    it("captures stderr separately from stdout", async () => {
        const r = (await bash("echo out && echo err >&2")) as BashResult;
        expect(r.stdout).toContain("out");
        expect(r.stderr).toContain("err");
    });

    it("filesystem writes in one call are visible in the next", async () => {
        await bash(`echo persistent > ${allowedDir}/scratch.txt`);
        const r = (await bash(`cat ${allowedDir}/scratch.txt`)) as BashResult;
        expect(r.exit_code).toBe(0);
        expect(r.stdout).toContain("persistent");
    });

    it("allows base64 encoding a normal file (readFileBuffer success path)", async () => {
        // base64 uses readFileBuffer internally; this exercises the
        // readFileBuffer wrapper for a non-denied file.
        const r = (await bash(`base64 ${allowedDir}/data.txt`)) as BashResult;
        expect(r.exit_code).toBe(0);
        // "hello world" base64-encodes to "aGVsbG8gd29ybGQ="
        expect(r.stdout).toContain("aGVsbG8gd29ybGQ");
    });

    it("truncates stdout when it exceeds maxOutputBytes", async () => {
        const tinyBash = makeBash(allowedDir, TIMEOUT_MS, 5);
        // "hello\n" is 6 bytes, exceeds the 5-byte cap.
        const r = (await tinyBash("echo hello")) as BashResult;
        expect(r.stdout).toContain("[output truncated]");
    });

    it("throws TypeError for non-string command", async () => {
        await expect(bash(42 as unknown as string)).rejects.toMatchObject({
            name: "TypeError",
        });
    });
});
