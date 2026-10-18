// Integration tests for Python error reporting across external-call boundaries.
// Uses real Monty and filesystem tools without generating BAM fixtures.

import {
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monty } from "@pydantic/monty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMontyWithExternalFunctions, runSandboxCode } from "./monty-sandbox";

let allowedDir: string;

beforeEach(async () => {
    // Canonical paths also work on macOS, where /var resolves to /private/var.
    allowedDir = await realpath(
        await mkdtemp(join(tmpdir(), "monty-error-propagation-")),
    );
});

afterEach(async () => {
    await rm(allowedDir, { recursive: true });
});

describe.each([
    {
        ordering: "without tool calls",
        prefix: "",
        suffix: "",
        errorLine: 1,
        completedFiles: [],
    },
    {
        ordering: "before an unreached tool call",
        prefix: "",
        suffix: '\nwrite_file("unreached.txt", "unexpected")',
        errorLine: 1,
        completedFiles: [],
    },
    {
        ordering: "after one completed tool call",
        prefix: 'write_file("first.txt", "completed")\n',
        suffix: "",
        errorLine: 2,
        completedFiles: ["first.txt"],
    },
    {
        ordering: "after two completed tool calls",
        prefix:
            'write_file("first.txt", "completed")\n' +
            'write_file("second.txt", "completed")\n',
        suffix: "",
        errorLine: 3,
        completedFiles: ["first.txt", "second.txt"],
    },
])("Python errors $ordering", ({
    prefix,
    suffix,
    errorLine,
    completedFiles,
}) => {
    it.each([
        {
            name: "ValueError",
            code: 'raise ValueError("boom")',
            options: {},
            expected: "ValueError: boom",
            isTimeout: false,
        },
        {
            name: "MemoryError",
            code: "x = [0] * 10_000_000",
            options: { maxMemory: 1024 * 1024 },
            expected: "MemoryError: memory limit exceeded",
            isTimeout: false,
        },
        {
            name: "TimeoutError",
            code: "while True:\n    pass",
            options: { maxDurationSecs: 1 },
            expected: "TimeoutError: time limit exceeded",
            isTimeout: true,
        },
    ])("preserves $name and its error details", async ({
        code,
        options,
        expected,
        isTimeout,
    }) => {
        const result = await runSandboxCode(
            prefix + code + suffix,
            allowedDir,
            options,
        );

        expect(result.success).toBe(false);
        expect(result.errorType).toBe("RuntimeError");
        expect(result.message).toContain(expected);
        expect(result.message).not.toContain("Invalid exception type");
        expect(result.isTimeout).toBe(isTimeout);
        // Monty reports resource timeouts without frames; ordinary exceptions
        // and Python allocation failures retain their source and line number.
        if (!isTimeout) {
            expect(result.message).toContain(
                "Traceback (most recent call last):",
            );
            expect(result.message).toContain(`line ${errorLine}`);
            expect(result.message).toContain(code);
        }

        const files = (await readdir(allowedDir))
            .filter((file) => file.endsWith(".txt"))
            .sort();
        expect(files).toEqual(completedFiles);
        for (const file of completedFiles) {
            expect(await readFile(join(allowedDir, file), "utf-8")).toBe(
                "completed",
            );
        }
    });
});

it("preserves MemoryError while importing an external tool return value", async () => {
    const content = "x".repeat(2 * 1024 * 1024);
    await writeFile(join(allowedDir, "large.txt"), content);
    const code = 'data = read_file("large.txt")\nlen(data["content"])';
    const maxReadBytes = 3 * 1024 * 1024;

    // The same real tool and file succeed with sufficient Python heap, ruling
    // out read-limit truncation or a read failure as the source of the error.
    const control = await runSandboxCode(code, allowedDir, {
        maxMemory: 8 * 1024 * 1024,
        maxReadBytes,
    });
    expect(control.success).toBe(true);
    expect(control.value).toBe(content.length);

    const result = await runSandboxCode(code, allowedDir, {
        maxMemory: 1024 * 1024,
        maxReadBytes,
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("RuntimeError");
    expect(result.message).toContain("MemoryError: memory limit exceeded");
    expect(result.message).not.toContain("Invalid exception type");
    expect(result.isTimeout).toBe(false);
});

it("resolves a registered external function during Python name lookup", async () => {
    const result = await runMontyWithExternalFunctions(
        new Monty("small is not None"),
        {
            limits: { maxDurationSecs: 1 },
            /**
             * Discards print output; this program only returns a value.
             *
             * @returns Nothing.
             */
            printCallback: () => undefined,
            externalFunctions: {
                /**
                 * Fails if name lookup invokes the host function.
                 */
                small: () => {
                    throw new Error("Name lookup must not invoke small");
                },
            },
        },
    );
    expect(result).toBe(true);
});

it("lets Python catch an ordinary async host error as RuntimeError and continue", async () => {
    const code =
        'message = "not caught"\n' +
        "try:\n" +
        "    fail()\n" +
        "except RuntimeError as error:\n" +
        "    message = str(error)\n" +
        "message";
    const result = await runMontyWithExternalFunctions(new Monty(code), {
        limits: { maxDurationSecs: 1 },
        /**
         * Discards print output; the caught error is returned instead.
         *
         * @returns Nothing.
         */
        printCallback: () => undefined,
        externalFunctions: {
            /**
             * Rejects with an ordinary JavaScript error, not SandboxError.
             */
            fail: async () => {
                throw new Error("host failure marker");
            },
        },
    });
    expect(result).toBe("Error: host failure marker");
});
