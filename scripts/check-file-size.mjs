#!/usr/bin/env node

// Enforces per-file line-count limits on TypeScript source files.
//
// Rules:
//   - Test files (*.test.ts):  max 1500 lines.
//   - Other source files:      max  800 lines.
//   - Files listed in EXCEPTIONS may exceed the default ceiling but must not
//     grow beyond their individual ceiling (their size at the time they were
//     grandfathered). This documents known debt and prevents it from worsening.
//
// "Lines" is counted the same way as `wc -l`: the number of newline characters
// in the file content, which equals the visual line count for any file that
// ends with a trailing newline (the convention enforced by the formatter).
//
// Modes:
//   default  — checks only staged src/*.ts files via `git diff --cached`.
//              Used by the pre-commit hook; unstaged changes are invisible.
//   --all    — checks every tracked src/*.ts file via `git ls-files`.
//              Used by CI, where nothing is staged.
//
// Run: node scripts/check-file-size.mjs          (pre-commit hook)
//      node scripts/check-file-size.mjs --all    (CI)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- Limits ---

/** Maximum line count for non-test source files. */
const SOURCE_MAX = 800;

/** Maximum line count for *.test.ts files. */
const TEST_MAX = 1500;

// Files that currently exceed the default ceiling for their category.
// Each entry maps a repo-relative path to its individual ceiling: the file
// must not grow beyond this value, but it need not shrink to pass the check.
// Remove an entry once the file is refactored below the default ceiling.
//
// Grandfathered at their wc -l values as of the time this check was added.

/** @type {Map<string, number>} */
const EXCEPTIONS = new Map([
    // Source files above the 800-line ceiling:
    ["src/lib/chat-orchestrator.ts", 1305], // raised from 1298: --rm-tools removedTools support
    ["src/renderer/ai-chat/ai-chat.ts", 1183],
    ["src/renderer/qc/qc-results.ts", 1146],
    // Test files above the 1500-line ceiling:
    ["src/lib/chat-orchestrator-handle-message.test.ts", 1554], // raised from 1500: --rm-tools tests
]);

// --- File discovery ---

const allMode = argv.includes("--all");

/**
 * Returns the list of repo-relative src/*.ts paths to check, and a function
 * to read the content of each one.
 *
 * In default mode, only staged files are returned and content is read from
 * the git index (so unstaged working-tree edits are invisible).
 * In --all mode, every tracked src/*.ts file is returned and content is read
 * from disk.
 *
 * @returns {{ files: string[], readContent: (relPath: string) => string | null }}
 */
function discoverFiles() {
    if (allMode) {
        const lsOutput = execFileSync("git", ["ls-files", "src/"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const files = lsOutput
            .trim()
            .split("\n")
            .filter((f) => f.length > 0 && f.endsWith(".ts"));

        return {
            files,
            /** @param {string} relPath */
            readContent: (relPath) => readFileSync(join(ROOT, relPath), "utf8"),
        };
    }

    // Default: staged files only.
    const diffOutput = execFileSync(
        "git",
        ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
        { cwd: ROOT, encoding: "utf8" },
    );
    const files = diffOutput
        .trim()
        .split("\n")
        .filter(
            (f) => f.length > 0 && f.endsWith(".ts") && f.startsWith("src/"),
        );

    return {
        files,
        /** @param {string} relPath */
        readContent: (relPath) => {
            try {
                return execFileSync("git", ["show", `:${relPath}`], {
                    cwd: ROOT,
                    encoding: "utf8",
                });
            } catch {
                // File removed from working tree but staged as modified — skip.
                return null;
            }
        },
    };
}

const { files, readContent } = discoverFiles();

if (files.length === 0) {
    process.exit(0);
}

// --- Check each file ---

/** @type {string[]} */
const errors = [];

for (const relPath of files) {
    const content = readContent(relPath);
    if (content === null) continue;

    // Count newline characters: matches `wc -l` for files with a trailing newline.
    const lineCount = (content.match(/\n/g) ?? []).length;
    const isTest = relPath.endsWith(".test.ts");
    const defaultMax = isTest ? TEST_MAX : SOURCE_MAX;
    const label = isTest ? "test" : "source";

    if (EXCEPTIONS.has(relPath)) {
        const ceiling = /** @type {number} */ (EXCEPTIONS.get(relPath));
        if (lineCount > ceiling) {
            errors.push(
                `  ✗ ${relPath}: ${lineCount} lines — exceeds grandfathered ceiling of ${ceiling}`,
            );
        }
    } else if (lineCount > defaultMax) {
        errors.push(
            `  ✗ ${relPath}: ${lineCount} lines — exceeds ${label} limit of ${defaultMax}`,
        );
    }
}

// --- Report ---

if (errors.length > 0) {
    console.error("File size check FAILED:\n");
    for (const msg of errors) {
        console.error(msg);
    }
    console.error(
        `\nLimits: source ≤ ${SOURCE_MAX} lines, test ≤ ${TEST_MAX} lines.`,
    );
    console.error(
        "Refactor the file, or add it to EXCEPTIONS in scripts/check-file-size.mjs",
    );
    console.error(
        "with its current line count as the ceiling (with a comment explaining the debt).",
    );
    process.exit(1);
}

console.log(`File size check PASSED (${files.length} file(s) checked).`);
