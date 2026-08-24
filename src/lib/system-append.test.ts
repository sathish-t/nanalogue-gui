// Tests for loadSystemAppend.
// Verifies file reading, symlink safety, and graceful handling of absent files.

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSystemAppend, MAX_SYSTEM_APPEND_BYTES } from "./system-append";

describe("loadSystemAppend", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "system-append-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("returns undefined when SYSTEM_APPEND.md is absent", async () => {
        const result = await loadSystemAppend(tmpDir);
        expect(result).toBeUndefined();
    });

    it("returns file content when SYSTEM_APPEND.md is present", async () => {
        const content = "## Domain context\nFocus on CpG methylation.";
        await writeFile(join(tmpDir, "SYSTEM_APPEND.md"), content, "utf-8");

        const result = await loadSystemAppend(tmpDir);
        expect(result).toBe(content);
    });

    it("rejects an empty SYSTEM_APPEND.md", async () => {
        await writeFile(join(tmpDir, "SYSTEM_APPEND.md"), "", "utf-8");

        await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
            "must not be empty",
        );
    });

    it("rejects SYSTEM_APPEND.md when it is not a regular file", async () => {
        await mkdir(join(tmpDir, "SYSTEM_APPEND.md"));

        await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
            "must be a regular file",
        );
    });

    it("rejects an inaccessible SYSTEM_APPEND.md path", async () => {
        await rm(tmpDir, { recursive: true });
        await writeFile(tmpDir, "not a directory");

        await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
            "exists but is not accessible",
        );
    });

    it("rejects a whitespace-only SYSTEM_APPEND.md", async () => {
        await writeFile(join(tmpDir, "SYSTEM_APPEND.md"), "   \n\t", "utf-8");

        await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
            "must not contain only whitespace",
        );
    });

    it("rejects SYSTEM_APPEND.md when it is a symlink outside the directory", async () => {
        // Create a sensitive file outside the allowed directory.
        const outsideDir = await mkdtemp(join(tmpdir(), "outside-"));
        try {
            await writeFile(
                join(outsideDir, "secret.txt"),
                "secret contents",
                "utf-8",
            );
            // Symlink inside the allowed dir → outside target.
            await symlink(
                join(outsideDir, "secret.txt"),
                join(tmpDir, "SYSTEM_APPEND.md"),
            );

            await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
                "could not be loaded safely",
            );
        } finally {
            await rm(outsideDir, { recursive: true, force: true });
        }
    });

    it("returns content when SYSTEM_APPEND.md is a symlink within the directory", async () => {
        const content = "## Allowed symlink target\nThis is fine.";
        await writeFile(join(tmpDir, "actual.md"), content, "utf-8");
        // Symlink inside the allowed dir → target also inside.
        await symlink(
            join(tmpDir, "actual.md"),
            join(tmpDir, "SYSTEM_APPEND.md"),
        );

        const result = await loadSystemAppend(tmpDir);
        expect(result).toBe(content);
    });

    it("rejects SYSTEM_APPEND.md above MAX_SYSTEM_APPEND_BYTES", async () => {
        // Write a file that is one byte over the limit.
        const oversized = "x".repeat(MAX_SYSTEM_APPEND_BYTES + 1);
        await writeFile(join(tmpDir, "SYSTEM_APPEND.md"), oversized, "utf-8");

        await expect(loadSystemAppend(tmpDir)).rejects.toThrow(
            "exceeds the 1 MiB limit",
        );
    });

    it("returns content when SYSTEM_APPEND.md is exactly MAX_SYSTEM_APPEND_BYTES", async () => {
        const atLimit = "x".repeat(MAX_SYSTEM_APPEND_BYTES);
        await writeFile(join(tmpDir, "SYSTEM_APPEND.md"), atLimit, "utf-8");

        const result = await loadSystemAppend(tmpDir);
        expect(result).toBe(atLimit);
    });

    it("returns undefined when called twice and file disappears between calls", async () => {
        const content = "## Initial content";
        const filePath = join(tmpDir, "SYSTEM_APPEND.md");
        await writeFile(filePath, content, "utf-8");

        const first = await loadSystemAppend(tmpDir);
        expect(first).toBe(content);

        await rm(filePath);

        // Second call — file is gone; must return undefined gracefully.
        const second = await loadSystemAppend(tmpDir);
        expect(second).toBeUndefined();
    });
});
