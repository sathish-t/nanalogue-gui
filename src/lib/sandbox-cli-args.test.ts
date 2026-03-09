// Tests for parseNumericArg and buildSandboxRunOptions in sandbox-cli-args.ts.
// Verifies validation, error messages, fallback behaviour, and error collection.

import { describe, expect, it } from "vitest";
import { buildSandboxRunOptions, parseNumericArg } from "./sandbox-cli-args";

// ---------------------------------------------------------------------------
// parseNumericArg
// ---------------------------------------------------------------------------

describe("parseNumericArg", () => {
    // Spec used throughout these tests: min=1, max=100, fallback=10.
    const spec = { min: 1, max: 100, fallback: 10 };

    it("returns fallback when value is undefined", () => {
        const result = parseNumericArg("my-flag", undefined, spec);
        expect(result).toEqual({ ok: true, value: 10 });
    });

    it("returns parsed integer for a valid value", () => {
        const result = parseNumericArg("my-flag", "42", spec);
        expect(result).toEqual({ ok: true, value: 42 });
    });

    it("rounds a float to the nearest integer", () => {
        const result = parseNumericArg("my-flag", "42.7", spec);
        expect(result).toEqual({ ok: true, value: 43 });
    });

    it("accepts the exact minimum", () => {
        const result = parseNumericArg("my-flag", "1", spec);
        expect(result).toEqual({ ok: true, value: 1 });
    });

    it("accepts the exact maximum", () => {
        const result = parseNumericArg("my-flag", "100", spec);
        expect(result).toEqual({ ok: true, value: 100 });
    });

    it("returns an error for a non-numeric string", () => {
        const result = parseNumericArg("my-flag", "abc", spec);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("--my-flag");
            expect(result.error).toContain('"abc"');
            expect(result.error).toContain("not a valid number");
        }
    });

    it("returns an error for an empty string", () => {
        const result = parseNumericArg("my-flag", "", spec);
        expect(result.ok).toBe(false);
    });

    it("returns an error for a value below minimum", () => {
        const result = parseNumericArg("my-flag", "0", spec);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("--my-flag");
            expect(result.error).toContain("0");
            expect(result.error).toContain("below the minimum of 1");
        }
    });

    it("returns an error for a value above maximum", () => {
        const result = parseNumericArg("my-flag", "101", spec);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("--my-flag");
            expect(result.error).toContain("101");
            expect(result.error).toContain("above the maximum of 100");
        }
    });

    it("includes the flag name with leading dashes in the error", () => {
        const result = parseNumericArg("max-duration-secs", "0", spec);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/^--max-duration-secs:/);
        }
    });
});

// ---------------------------------------------------------------------------
// buildSandboxRunOptions
// ---------------------------------------------------------------------------

describe("buildSandboxRunOptions", () => {
    it("returns defaults when no flags are provided", () => {
        const opts = buildSandboxRunOptions({}, 1024);
        expect(opts.maxRecordsReadInfo).toBe(200_000);
        expect(opts.maxRecordsBamMods).toBe(5_000);
        expect(opts.maxDurationSecs).toBe(600);
        expect(opts.maxOutputBytes).toBe(1024);
    });

    it("applies a valid flag value", () => {
        const opts = buildSandboxRunOptions(
            { "max-records-read-info": "500" },
            1024,
        );
        expect(opts.maxRecordsReadInfo).toBe(500);
    });

    it("converts memory MB to bytes", () => {
        const opts = buildSandboxRunOptions({ "max-memory-mb": "2" }, 1024);
        expect(opts.maxMemory).toBe(2 * 1024 * 1024);
    });

    it("converts read MB to bytes", () => {
        const opts = buildSandboxRunOptions({ "max-read-mb": "3" }, 1024);
        expect(opts.maxReadBytes).toBe(3 * 1024 * 1024);
    });

    it("converts write MB to bytes", () => {
        const opts = buildSandboxRunOptions({ "max-write-mb": "4" }, 1024);
        expect(opts.maxWriteBytes).toBe(4 * 1024 * 1024);
    });

    it("throws for a single invalid flag", () => {
        expect(() =>
            buildSandboxRunOptions({ "max-duration-secs": "0" }, 1024),
        ).toThrow(/--max-duration-secs/);
    });

    it("throws for a non-numeric flag value", () => {
        expect(() =>
            buildSandboxRunOptions({ "max-memory-mb": "banana" }, 1024),
        ).toThrow(/--max-memory-mb/);
    });

    it("collects all errors from multiple bad flags and throws once", () => {
        let caught: unknown;
        try {
            buildSandboxRunOptions(
                {
                    "max-duration-secs": "0",
                    "max-memory-mb": "banana",
                    "max-allocations": "-5",
                },
                1024,
            );
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        const msg = (caught as Error).message;
        expect(msg).toContain("--max-duration-secs");
        expect(msg).toContain("--max-memory-mb");
        expect(msg).toContain("--max-allocations");
    });

    it("passes maxOutputBytes through unchanged", () => {
        const opts = buildSandboxRunOptions({}, 99_999);
        expect(opts.maxOutputBytes).toBe(99_999);
    });
});
