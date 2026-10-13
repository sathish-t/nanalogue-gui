// Node-only checks for chat analysis directories and Python source files.

import { constants } from "node:fs";
import { access, open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
    MAX_INPUT_PATH_LENGTH,
    MAX_PYTHON_SOURCE_BYTES,
} from "./ai-chat-shared-constants";
import { hasControlChars } from "./monty-sandbox-helpers";

/** Error messages and byte ceiling for a bounded regular-file read. */
export interface BoundedRegularFileOptions {
    /** Maximum accepted file bytes. */
    maxBytes: number;
    /** Error used when the opened handle is not a regular file. */
    notRegularError: string;
    /** Error used when more than maxBytes can be read. */
    tooLargeError: string;
    /** Error used when the canonical path cannot be opened or read. */
    unreadableError: string;
}

/**
 * Opens one canonical file without following a substituted final symlink and reads at most maxBytes + 1.
 *
 * @param canonicalPath - Canonical path previously resolved inside its security boundary.
 * @param options - Byte ceiling and caller-specific errors.
 * @returns UTF-8 text read from the validated file handle.
 * @throws {Error} If the handle is unreadable, non-regular, or oversized.
 */
export async function readBoundedRegularFile(
    canonicalPath: string,
    options: BoundedRegularFileOptions,
): Promise<string> {
    let fileHandle: Awaited<ReturnType<typeof open>>;
    try {
        fileHandle = await open(
            canonicalPath,
            constants.O_RDONLY | constants.O_NOFOLLOW,
        );
    } catch (error) {
        throw new Error(options.unreadableError, { cause: error });
    }

    try {
        const fileStat = await fileHandle.stat();
        if (!fileStat.isFile()) throw new Error(options.notRegularError);
        if (fileStat.size > options.maxBytes) {
            throw new Error(options.tooLargeError);
        }

        const buffer = Buffer.alloc(options.maxBytes + 1);
        let totalBytes = 0;
        while (totalBytes < buffer.length) {
            const { bytesRead } = await fileHandle.read(
                buffer,
                totalBytes,
                buffer.length - totalBytes,
                null,
            );
            if (bytesRead === 0) break;
            totalBytes += bytesRead;
        }
        if (totalBytes > options.maxBytes) {
            throw new Error(options.tooLargeError);
        }
        return buffer.subarray(0, totalBytes).toString("utf-8");
    } catch (error) {
        if (
            error instanceof Error &&
            (error.message === options.notRegularError ||
                error.message === options.tooLargeError)
        ) {
            throw error;
        }
        throw new Error(options.unreadableError, { cause: error });
    } finally {
        await fileHandle.close();
    }
}

/**
 * Validates the textual form and extension of a Python source path.
 *
 * @param pathInput - User-supplied or resolved Python source path.
 * @throws {Error} If the path text is malformed or does not end in .py.
 */
export function validatePythonSourcePath(pathInput: string): void {
    if (
        pathInput.length <= ".py".length ||
        pathInput.length > MAX_INPUT_PATH_LENGTH ||
        pathInput !== pathInput.trim() ||
        hasControlChars(pathInput)
    ) {
        throw new Error("Python script path is malformed");
    }
    if (!pathInput.endsWith(".py")) {
        throw new Error("Python script must be a .py file");
    }
}

/**
 * Resolves and validates an existing readable analysis directory.
 *
 * @param directoryInput - Absolute or cwd-relative user-supplied directory.
 * @param cwd - Directory against which relative input is resolved.
 * @returns Canonical real path used as the sandbox boundary.
 * @throws {Error} If the input is malformed or does not identify an accessible directory.
 */
export async function validateAnalysisDirectory(
    directoryInput: string,
    cwd: string,
): Promise<string> {
    if (directoryInput.length === 0) {
        throw new Error("Analysis directory is required");
    }
    if (directoryInput !== directoryInput.trim()) {
        throw new Error(
            "Analysis directory must not have surrounding whitespace",
        );
    }
    if (
        directoryInput.length > MAX_INPUT_PATH_LENGTH ||
        hasControlChars(directoryInput)
    ) {
        throw new Error("Analysis directory path is malformed");
    }

    const resolvedPath = resolve(cwd, directoryInput);
    let canonicalPath: string;
    try {
        canonicalPath = await realpath(resolvedPath);
        const directoryStat = await stat(canonicalPath);
        if (!directoryStat.isDirectory()) {
            throw new Error("Analysis directory must identify a directory");
        }
        await access(canonicalPath, constants.R_OK | constants.X_OK);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.startsWith("Analysis directory")
        ) {
            throw error;
        }
        throw new Error(
            "Analysis directory does not exist or is not accessible",
            { cause: error },
        );
    }
    return canonicalPath;
}

/**
 * Reads a regular Python source file after validating its path and 10 MiB size limit.
 *
 * @param filePath - Resolved path to the Python source file.
 * @returns UTF-8 Python source text.
 * @throws {Error} If the path or file is malformed, inaccessible, or oversized.
 */
export async function readValidatedPythonSource(
    filePath: string,
): Promise<string> {
    validatePythonSourcePath(filePath);

    let canonicalPath: string;
    try {
        canonicalPath = await realpath(filePath);
    } catch {
        throw new Error("Python script does not exist or is not readable");
    }
    return readBoundedRegularFile(canonicalPath, {
        maxBytes: MAX_PYTHON_SOURCE_BYTES,
        notRegularError: "Python script must be a regular file",
        tooLargeError: "Python script exceeds the 10 MiB limit",
        unreadableError: "Python script does not exist or is not readable",
    });
}
