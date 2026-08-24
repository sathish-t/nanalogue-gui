// Tests for analysis-directory and Python-source filesystem checks.

import {
    mkdir,
    mkdtemp,
    open,
    rm,
    stat,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PYTHON_SOURCE_BYTES } from "./ai-chat-shared-constants";
import {
    readBoundedRegularFile,
    readValidatedPythonSource,
    validateAnalysisDirectory,
    validatePythonSourcePath,
} from "./chat-filesystem-input-checks";

describe("chat filesystem input validation", () => {
    let temporaryDirectory: string;

    beforeEach(async () => {
        temporaryDirectory = await mkdtemp(join(tmpdir(), "chat-input-"));
    });

    afterEach(async () => {
        await rm(temporaryDirectory, { recursive: true, force: true });
    });

    it("returns the canonical path of an existing directory", async () => {
        const directory = join(temporaryDirectory, "analysis");
        const alias = join(temporaryDirectory, "analysis-alias");
        await mkdir(directory);
        await symlink(directory, alias);

        await expect(
            validateAnalysisDirectory("analysis-alias", temporaryDirectory),
        ).resolves.toBe(directory);
    });

    it.each([
        " analysis",
        "analysis ",
        "bad\u0000path",
    ])("rejects malformed directory input %j", async (directoryInput) => {
        await expect(
            validateAnalysisDirectory(directoryInput, temporaryDirectory),
        ).rejects.toThrow(/directory/i);
    });

    it("rejects a missing analysis directory", async () => {
        await expect(
            validateAnalysisDirectory("missing", temporaryDirectory),
        ).rejects.toThrow("does not exist or is not accessible");
    });

    it("rejects an empty analysis directory input", async () => {
        await expect(
            validateAnalysisDirectory("", temporaryDirectory),
        ).rejects.toThrow("Analysis directory is required");
    });

    it("rejects a regular file as the analysis directory", async () => {
        await writeFile(join(temporaryDirectory, "file.txt"), "content");
        await expect(
            validateAnalysisDirectory("file.txt", temporaryDirectory),
        ).rejects.toThrow("must identify a directory");
    });

    it.each([
        ".py",
        " script.py",
        "script.py ",
        "script.txt",
        "bad\u0000.py",
    ])("rejects malformed Python path %j", (pathInput) => {
        expect(() => validatePythonSourcePath(pathInput)).toThrow();
    });

    it("reads a regular Python file at the size limit", async () => {
        const scriptPath = join(temporaryDirectory, "script.py");
        const source = "x".repeat(MAX_PYTHON_SOURCE_BYTES);
        await writeFile(scriptPath, source);

        await expect(readValidatedPythonSource(scriptPath)).resolves.toBe(
            source,
        );
    });

    it("rejects a Python file above the 10 MiB limit", async () => {
        const scriptPath = join(temporaryDirectory, "large.py");
        await writeFile(scriptPath, "x".repeat(MAX_PYTHON_SOURCE_BYTES + 1));

        await expect(readValidatedPythonSource(scriptPath)).rejects.toThrow(
            "exceeds the 10 MiB limit",
        );
    });

    it("rejects a directory named with a .py suffix", async () => {
        const scriptDirectory = join(temporaryDirectory, "directory.py");
        await mkdir(scriptDirectory);

        await expect(
            readValidatedPythonSource(scriptDirectory),
        ).rejects.toThrow("regular file");
    });

    it("rejects a missing Python source file", async () => {
        await expect(
            readValidatedPythonSource(join(temporaryDirectory, "missing.py")),
        ).rejects.toThrow("does not exist or is not readable");
    });

    it("rejects an oversized file from its opened-handle metadata", async () => {
        const scriptPath = join(temporaryDirectory, "growing.py");
        await writeFile(scriptPath, "1234");

        await expect(
            readBoundedRegularFile(scriptPath, {
                maxBytes: 3,
                notRegularError: "not regular",
                tooLargeError: "too large",
                unreadableError: "unreadable",
            }),
        ).rejects.toThrow("too large");
    });

    it("rejects content that grows after opened-handle metadata is read", async () => {
        const scriptPath = join(temporaryDirectory, "growing.py");
        await writeFile(scriptPath, "1234");
        const fileHandle = await open(scriptPath, "r");
        const fileHandlePrototype = Object.getPrototypeOf(fileHandle);
        await fileHandle.close();
        const underreportedStat = await stat(scriptPath);
        Object.defineProperty(underreportedStat, "size", { value: 1 });
        const statSpy = vi
            .spyOn(fileHandlePrototype, "stat")
            .mockResolvedValue(underreportedStat);

        try {
            await expect(
                readBoundedRegularFile(scriptPath, {
                    maxBytes: 3,
                    notRegularError: "not regular",
                    tooLargeError: "too large",
                    unreadableError: "unreadable",
                }),
            ).rejects.toThrow("too large");
        } finally {
            statSpy.mockRestore();
        }
    });

    it("maps an opened-handle read failure to the caller's error", async () => {
        const scriptPath = join(temporaryDirectory, "unreadable.py");
        await writeFile(scriptPath, "content");
        const fileHandle = await open(scriptPath, "r");
        const fileHandlePrototype = Object.getPrototypeOf(fileHandle);
        await fileHandle.close();
        const readSpy = vi
            .spyOn(fileHandlePrototype, "read")
            .mockRejectedValue(new Error("read failed"));

        try {
            await expect(
                readBoundedRegularFile(scriptPath, {
                    maxBytes: MAX_PYTHON_SOURCE_BYTES,
                    notRegularError: "not regular",
                    tooLargeError: "too large",
                    unreadableError: "unreadable",
                }),
            ).rejects.toThrow("unreadable");
        } finally {
            readSpy.mockRestore();
        }
    });

    it("does not follow a substituted final symlink", async () => {
        const targetPath = join(temporaryDirectory, "target.py");
        const substitutedPath = join(temporaryDirectory, "substituted.py");
        await writeFile(targetPath, "print('outside')");
        await symlink(targetPath, substitutedPath);

        await expect(
            readBoundedRegularFile(substitutedPath, {
                maxBytes: MAX_PYTHON_SOURCE_BYTES,
                notRegularError: "not regular",
                tooLargeError: "too large",
                unreadableError: "unreadable",
            }),
        ).rejects.toThrow("unreadable");
    });
});
