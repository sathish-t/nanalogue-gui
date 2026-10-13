// Contract tests for restricted, platform-independent sandbox glob matching.

import { describe, expect, it } from "vitest";
import { compileSandboxGlob } from "./sandbox-glob";

describe("compileSandboxGlob", () => {
    it.each([
        ["sample.bam", "sample.bam", true],
        ["sample.bam", "Sample.bam", false],
        ["*.bam", "sample.BAM", false],
        ["*.bam", "sample.bam", true],
        ["*.bam", "run/sample.bam", false],
        ["a*b", "ab", true],
        ["a*b", "axyb", true],
        ["a*b", "axybc", false],
        ["a*b", "xaab", false],
        ["sample?.bam", "sample1.bam", true],
        ["sample?.bam", "sample.bam", false],
        ["sample?.bam", "sample12.bam", false],
        ["sample?.bam", "sample🧬.bam", true],
        ["sample??.bam", "sample🧬.bam", false],
        ["**/*.bam", "sample.bam", true],
        ["**/*.bam", "a/b/sample.bam", true],
        ["sample_001/**/*.bam", "sample_001/direct.bam", true],
        ["sample_001/**/*.bam", "sample_001/run/deep.bam", true],
        ["sample_001/**/*.bam", "sample_002/direct.bam", false],
        ["run/*.bam", "run/deeper/sample.bam", false],
        ["run/*/*.bam", "run/deeper/sample.bam", true],
        ["**/run/**/x.bam", "a/run/b/run/x.bam", true],
        ["run/**", "run/a/b.txt", true],
        ["**/**/x.bam", "x.bam", true],
        ["**/**/x.bam", "a/b/x.bam", true],
        ["*.txt", ".notes.txt", false],
        ["?notes.txt", ".notes.txt", false],
        [".*.txt", ".notes.txt", true],
        ["**/*.bam", ".cache/sample.bam", false],
        ["**", "run/.cache/sample.bam", false],
        ["**/*.bam", "run/.sample.bam", false],
        [".cache/*.bam", ".cache/sample.bam", true],
        [".cache/*.bam", ".cache/.sample.bam", false],
        ["**/.cache/*.bam", "run/.cache/sample.bam", true],
        ["**/.cache/*.bam", ".cache/sample.bam", true],
        ["**/.cache/**", ".cache/deep/sample.bam", true],
        ["**/.*.bam", "run/.sample.bam", true],
        ["run (1)/a+b.bam", "run (1)/a+b.bam", true],
    ])("%s matching %s is %s", (pattern, filePath, expected) => {
        expect(compileSandboxGlob(pattern)(filePath)).toBe(expected);
    });

    it.each([
        "{1..1000000000}",
        "{a,b}".repeat(25),
        "[ab]*.bam",
        "x].bam",
        "!*.bam",
        "@(a|b).bam",
        "+(a).bam",
        "?(a).bam",
        "*(a).bam",
        "!(a).bam",
        "run\\*.bam",
        "a**b",
        "***",
        "**.bam",
        "/absolute.bam",
        "run//*.bam",
        "run/",
        "./*.bam",
        "run/../*.bam",
        "",
    ])("rejects unsupported pattern %s", (pattern) => {
        expect(() => compileSandboxGlob(pattern)).toThrow(
            expect.objectContaining({
                name: "ValueError",
                message: expect.stringContaining(
                    "ls() unsupported glob pattern",
                ),
            }),
        );
    });

    it("accepts the length boundary and rejects the next code unit", () => {
        const pattern = "a".repeat(1024);
        expect(compileSandboxGlob(pattern)(pattern)).toBe(true);
        expect(() => compileSandboxGlob(`${pattern}a`)).toThrow(
            expect.objectContaining({
                name: "ValueError",
                message: expect.stringContaining("1024"),
            }),
        );
    });

    it("handles adversarial wildcard failures and reuses the compiled matcher", () => {
        const filenameMatcher = compileSandboxGlob(`${"*a".repeat(200)}b`);
        expect(filenameMatcher(`${"a".repeat(240)}c`)).toBe(false);
        expect(filenameMatcher(`${"a".repeat(240)}b`)).toBe(true);
        expect(filenameMatcher("ab")).toBe(false);
        const pathMatcher = compileSandboxGlob(`${"**/a/".repeat(100)}end`);
        expect(pathMatcher(`${"a/".repeat(150)}wrong`)).toBe(false);
        expect(pathMatcher(`${"a/".repeat(150)}end`)).toBe(true);
    });
});
