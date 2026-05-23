// Tests for validateIpcFilePath: verifies absolute-path, control-char, and
// realpath checks for both read and write purposes.

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateIpcFilePath } from "./ipc-path-validation";

let tmpDir: string;
let existingFile: string;

beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ipc-path-validation-test-"));
    // Resolve symlinks so macOS /var → /private/var matches realpath output.
    tmpDir = await realpath(raw);
    existingFile = join(tmpDir, "sample.txt");
    await writeFile(existingFile, "data");
});

afterAll(async () => {
    await rm(tmpDir, { recursive: true });
});

describe("validateIpcFilePath – read", () => {
    it("rejects a relative path", async () => {
        await expect(
            validateIpcFilePath("relative/path.txt", "read"),
        ).rejects.toThrow("absolute");
    });

    it("rejects a path containing a null byte", async () => {
        await expect(
            validateIpcFilePath("/tmp/\x00evil.txt", "read"),
        ).rejects.toThrow("control");
    });

    it("rejects a path containing an ASCII control character", async () => {
        await expect(
            validateIpcFilePath("/tmp/\x1fevil.txt", "read"),
        ).rejects.toThrow("control");
    });

    it("rejects a non-existent file", async () => {
        await expect(
            validateIpcFilePath(join(tmpDir, "does-not-exist.txt"), "read"),
        ).rejects.toThrow();
    });

    it("accepts an existing absolute file path", async () => {
        await expect(
            validateIpcFilePath(existingFile, "read"),
        ).resolves.toBeUndefined();
    });
});

describe("validateIpcFilePath – write", () => {
    it("rejects a relative path", async () => {
        await expect(
            validateIpcFilePath("output/result.bed", "write"),
        ).rejects.toThrow("absolute");
    });

    it("rejects a path containing a control character", async () => {
        await expect(
            validateIpcFilePath("/tmp/\x0bmalicious.bed", "write"),
        ).rejects.toThrow("control");
    });

    it("rejects a path whose parent directory does not exist", async () => {
        await expect(
            validateIpcFilePath("/nonexistent-dir-xyz/output.bed", "write"),
        ).rejects.toThrow();
    });

    it("accepts a path whose parent directory exists (file need not exist yet)", async () => {
        const newFile = join(tmpDir, "output.bed");
        await expect(validateIpcFilePath(newFile, "write")).resolves.toBeUndefined();
    });

    it("accepts an absolute path targeting an existing file for overwrite", async () => {
        await expect(
            validateIpcFilePath(existingFile, "write"),
        ).resolves.toBeUndefined();
    });
});
