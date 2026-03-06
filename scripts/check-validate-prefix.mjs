#!/usr/bin/env node

// Enforces the validate* naming convention on exported functions in
// *-validation.ts files.
//
// Rationale: validation modules are entry points for IPC payload validation.
// Every function they export is a validation entry point, so naming it
// validate* makes the contract self-documenting and makes grep-auditing
// straightforward.  The convention is consistent across the codebase; this
// check prevents agents from introducing check*, verify*, or other synonyms.
//
// Modes:
//   default  — checks only staged *-validation.ts files via `git diff --cached`.
//              Used by the pre-commit hook; unstaged changes are invisible.
//   --all    — checks every tracked *-validation.ts file via `git ls-files`.
//              Used by CI, where nothing is staged.
//
// Run: node scripts/check-validate-prefix.mjs          (pre-commit hook)
//      node scripts/check-validate-prefix.mjs --all    (CI)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- File discovery ---

const allMode = argv.includes("--all");

/**
 * Returns validation file paths and a content reader for the current mode.
 *
 * In default mode, only staged *-validation.ts files are returned and content
 * is read from the git index.  In --all mode, every tracked *-validation.ts
 * file is returned and content is read from disk.
 *
 * @returns {{ files: string[], readContent: (relPath: string) => string | null }}
 */
function discoverFiles() {
    /** @param {string} f */
    const isValidationFile = (f) =>
        f.endsWith(".ts") && f.includes("-validation");

    if (allMode) {
        const lsOutput = execFileSync("git", ["ls-files", "src/"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        const files = lsOutput
            .trim()
            .split("\n")
            .filter((f) => f.length > 0 && isValidationFile(f));

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
        .filter((f) => f.length > 0 && isValidationFile(f));

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

// Matches any exported function declaration (sync or async) whose name does
// NOT start with "validate".  The selector intentionally covers only the
// `export function` declaration form; `export const fn = () => ...` arrow
// exports are not currently used in validation files.
const EXPORT_FN_RE = /^export (?:async )?function (\w+)/gm;

for (const relPath of files) {
    const content = readContent(relPath);
    if (content === null) continue;

    EXPORT_FN_RE.lastIndex = 0;
    /** @type {string[]} */
    const violations = [];

    for (const match of content.matchAll(EXPORT_FN_RE)) {
        const fnName = match[1];
        if (!fnName.startsWith("validate")) {
            violations.push(
                `  exported function "${fnName}" must be named validate*`,
            );
        }
    }

    if (violations.length > 0) {
        errors.push(`  ✗ ${relPath}:`);
        for (const v of violations) {
            errors.push(v);
        }
    }
}

// --- Report ---

if (errors.length > 0) {
    console.error("validate* prefix check FAILED:\n");
    for (const msg of errors) {
        console.error(msg);
    }
    console.error(
        "\nAll exported functions in *-validation.ts files must be named validate*.",
    );
    process.exit(1);
}

console.log(`validate* prefix check PASSED (${files.length} file(s) checked).`);
