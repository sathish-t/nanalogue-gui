// Tests for the sensitive-file deny-list in monty-sandbox.
// Covers read_file blocking, ls filtering, hidden-directory matching,
// case-insensitive matching, and correct behaviour when allowedDir is a symlink.

import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSandboxCode } from "./monty-sandbox";

// ---------------------------------------------------------------------------
// Shared temp directory — one real dir plus a symlink alias to it.
// All sensitive and normal files are created here before the suite runs.
// ---------------------------------------------------------------------------

/** Real canonical allowedDir used for most tests. */
let allowedDir: string;
/** Symlink that points at allowedDir — used for symlinked-allowedDir tests. */
let symlinkAllowedDir: string;

beforeAll(async () => {
    const raw = await import("node:fs/promises").then((fs) =>
        fs.mkdtemp(join(tmpdir(), "deny-list-test-")),
    );
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    allowedDir = await realpath(raw);

    // Create a sibling symlink to the same real directory.
    const symlinkRaw = `${raw}-link`;
    await symlink(allowedDir, symlinkRaw);
    symlinkAllowedDir = symlinkRaw;

    // --- Sensitive files ---
    await writeFile(join(allowedDir, "private.key"), "key content");
    await writeFile(join(allowedDir, "cert.pem"), "cert content");
    await writeFile(join(allowedDir, "server.crt"), "cert content");
    await writeFile(join(allowedDir, "server.cer"), "cert content");
    await writeFile(join(allowedDir, "keystore.p12"), "p12 content");
    await writeFile(join(allowedDir, "keystore.pfx"), "pfx content");
    await writeFile(join(allowedDir, ".env"), "SECRET=hunter2");
    await writeFile(join(allowedDir, ".env.local"), "LOCAL=1");
    await writeFile(join(allowedDir, "id_rsa"), "rsa key");
    await writeFile(join(allowedDir, "id_ed25519"), "ed25519 key");
    await writeFile(join(allowedDir, "id_dsa"), "dsa key");
    await writeFile(join(allowedDir, "id_ecdsa"), "ecdsa key");
    await writeFile(join(allowedDir, "cloud.credentials"), "token=abc");
    await writeFile(join(allowedDir, "backup.gpg"), "encrypted");

    // --- Sensitive files inside a hidden directory (tests dot: true) ---
    await mkdir(join(allowedDir, ".ssh"), { recursive: true });
    await writeFile(join(allowedDir, ".ssh", "id_rsa"), "ssh rsa key");
    await writeFile(join(allowedDir, ".ssh", "id_ed25519"), "ssh ed25519 key");
    await writeFile(join(allowedDir, ".ssh", "cert.pem"), "ssh cert");

    // --- Uppercase-extension variants (tests nocase: true) ---
    await writeFile(join(allowedDir, "CERT.PEM"), "upper cert");
    await writeFile(join(allowedDir, "PRIVATE.KEY"), "upper key");
    await writeFile(join(allowedDir, "ID_RSA"), "upper rsa");

    // --- Normal files that must never be blocked ---
    await writeFile(join(allowedDir, "safe.txt"), "safe content");
    await writeFile(join(allowedDir, "reads.bam.bai"), "index");
    await writeFile(join(allowedDir, "results.bed"), "chr1\t100\t200\n");
});

afterAll(async () => {
    // Remove symlink before recursively deleting the real directory.
    await rm(symlinkAllowedDir);
    await rm(allowedDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// read_file — blocked files
// ---------------------------------------------------------------------------

describe("read_file deny-list blocking", () => {
    it("blocks *.key files with a not-permitted error", async () => {
        const result = await runSandboxCode(
            'read_file("private.key")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.pem files", async () => {
        const result = await runSandboxCode(
            'read_file("cert.pem")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.crt files", async () => {
        const result = await runSandboxCode(
            'read_file("server.crt")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.cer files", async () => {
        const result = await runSandboxCode(
            'read_file("server.cer")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.p12 files", async () => {
        const result = await runSandboxCode(
            'read_file("keystore.p12")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.pfx files", async () => {
        const result = await runSandboxCode(
            'read_file("keystore.pfx")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks .env files", async () => {
        const result = await runSandboxCode('read_file(".env")', allowedDir);
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks .env.* files", async () => {
        const result = await runSandboxCode(
            'read_file(".env.local")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks id_rsa files", async () => {
        const result = await runSandboxCode('read_file("id_rsa")', allowedDir);
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks id_ed25519 files", async () => {
        const result = await runSandboxCode(
            'read_file("id_ed25519")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks id_dsa files", async () => {
        const result = await runSandboxCode('read_file("id_dsa")', allowedDir);
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks id_ecdsa files", async () => {
        const result = await runSandboxCode(
            'read_file("id_ecdsa")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.credentials files", async () => {
        const result = await runSandboxCode(
            'read_file("cloud.credentials")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.gpg files", async () => {
        const result = await runSandboxCode(
            'read_file("backup.gpg")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    // dot: true — files inside hidden directories must be caught
    it("blocks id_rsa inside a hidden directory (.ssh/id_rsa)", async () => {
        const result = await runSandboxCode(
            'read_file(".ssh/id_rsa")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks id_ed25519 inside a hidden directory", async () => {
        const result = await runSandboxCode(
            'read_file(".ssh/id_ed25519")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks *.pem inside a hidden directory", async () => {
        const result = await runSandboxCode(
            'read_file(".ssh/cert.pem")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    // nocase: true — uppercase variants must be caught
    it("blocks uppercase *.PEM files (nocase)", async () => {
        const result = await runSandboxCode(
            'read_file("CERT.PEM")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks uppercase *.KEY files (nocase)", async () => {
        const result = await runSandboxCode(
            'read_file("PRIVATE.KEY")',
            allowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("blocks uppercase ID_RSA files (nocase)", async () => {
        const result = await runSandboxCode('read_file("ID_RSA")', allowedDir);
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    // Normal files must not be blocked
    it("allows normal .txt files", async () => {
        const result = await runSandboxCode(
            'read_file("safe.txt")',
            allowedDir,
        );
        expect(result.success).toBe(true);
        const value = result.value as Record<string, unknown>;
        expect(value.content).toBe("safe content");
    });

    it("allows .bai files (not on deny-list)", async () => {
        const result = await runSandboxCode(
            'read_file("reads.bam.bai")',
            allowedDir,
        );
        expect(result.success).toBe(true);
    });

    it("allows .bed files (not on deny-list)", async () => {
        const result = await runSandboxCode(
            'read_file("results.bed")',
            allowedDir,
        );
        expect(result.success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// ls — filtered files
// ---------------------------------------------------------------------------

describe("ls deny-list filtering", () => {
    it("hides *.key files from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("private.key");
    });

    it("hides *.pem files from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("cert.pem");
    });

    it("hides .env from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain(".env");
    });

    it("hides .env.local from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain(".env.local");
    });

    it("hides id_rsa from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("id_rsa");
    });

    it("hides *.credentials from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("cloud.credentials");
    });

    it("hides *.gpg from ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("backup.gpg");
    });

    // dot: true — files inside hidden directories
    it("hides .ssh/id_rsa from ls (hidden directory)", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        const files = result.value as string[];
        expect(files).not.toContain(".ssh/id_rsa");
        expect(files).not.toContain(".ssh/id_ed25519");
        expect(files).not.toContain(".ssh/cert.pem");
    });

    // nocase: true — uppercase variants
    it("hides uppercase *.PEM files from ls (nocase)", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("CERT.PEM");
    });

    it("hides uppercase *.KEY files from ls (nocase)", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("PRIVATE.KEY");
    });

    it("hides uppercase ID_RSA from ls (nocase)", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).not.toContain("ID_RSA");
    });

    // Normal files must still appear
    it("still shows safe.txt in ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).toContain("safe.txt");
    });

    it("still shows results.bed in ls", async () => {
        const result = await runSandboxCode("ls()", allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).toContain("results.bed");
    });

    // Glob pattern + deny-list work together
    it("glob pattern ls('**/*.pem') returns empty when all .pem files are denied", async () => {
        const result = await runSandboxCode('ls("**/*.pem")', allowedDir);
        expect(result.success).toBe(true);
        // All .pem files in this dir are on the deny-list; none should survive.
        expect(result.value).toEqual([]);
    });

    it("glob pattern ls('**/*.txt') still returns safe.txt", async () => {
        const result = await runSandboxCode('ls("**/*.txt")', allowedDir);
        expect(result.success).toBe(true);
        expect(result.value).toContain("safe.txt");
    });
});

// ---------------------------------------------------------------------------
// Symlinked allowedDir — the realpath(allowedDir) fix
// When allowedDir itself is a symlink, relative() would produce
// ../../real/.env-style paths without the fix, silently bypassing the check.
// ---------------------------------------------------------------------------

describe("deny-list with symlinked allowedDir", () => {
    it("read_file blocks denied files when allowedDir is a symlink", async () => {
        const result = await runSandboxCode(
            'read_file("cert.pem")',
            symlinkAllowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("read_file blocks id_rsa when allowedDir is a symlink", async () => {
        const result = await runSandboxCode(
            'read_file("id_rsa")',
            symlinkAllowedDir,
        );
        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toMatch(/not permitted/);
    });

    it("read_file still allows safe.txt when allowedDir is a symlink", async () => {
        const result = await runSandboxCode(
            'read_file("safe.txt")',
            symlinkAllowedDir,
        );
        expect(result.success).toBe(true);
    });

    it("ls hides denied files when allowedDir is a symlink", async () => {
        const result = await runSandboxCode("ls()", symlinkAllowedDir);
        expect(result.success).toBe(true);
        const files = result.value as string[];
        expect(files).not.toContain("cert.pem");
        expect(files).not.toContain("private.key");
        expect(files).not.toContain("id_rsa");
        expect(files).not.toContain(".env");
    });

    it("ls still shows safe.txt when allowedDir is a symlink", async () => {
        const result = await runSandboxCode("ls()", symlinkAllowedDir);
        expect(result.success).toBe(true);
        expect(result.value).toContain("safe.txt");
    });
});
