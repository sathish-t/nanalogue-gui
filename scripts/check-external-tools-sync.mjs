#!/usr/bin/env node

// Verifies that the three declarations of external AI tool names are in sync:
//
//   1. EXTERNAL_FUNCTIONS constant in src/lib/ai-chat-constants.ts
//   2. Source files in src/lib/ai-external-tools/ (excluding index.ts and *.test.ts)
//   3. Top-level keys of the registration object inside Object.fromEntries(Object.entries({…}))
//      in src/lib/monty-sandbox.ts
//
// Each location independently declares the set of external tools.  When a new
// tool is added or an old one is removed, all three must be updated together.
// This script fails the commit if any pair is out of step with the others.
//
// Tool names are derived automatically from each source — no list of names is
// hardcoded in this file:
//   - From the constant : string literals inside the EXTERNAL_FUNCTIONS array.
//   - From the folder   : filenames with kebab-to-snake conversion and .ts stripped.
//   - From the sandbox  : top-level object keys parsed with a depth-tracking scan
//                         so that nested braces inside values are not confused with keys.
//
// Modes:
//   default  — reads all three sources from the git index (staged snapshot) via
//              `git show :path` / `git ls-files --cached`.  Used by the pre-commit
//              hook; unstaged working-tree edits are invisible and cannot skew the result.
//   --all    — reads all three sources from disk.  Used by CI where nothing is staged.
//
// Run: node scripts/check-external-tools-sync.mjs          (pre-commit / manual)
//      node scripts/check-external-tools-sync.mjs --all    (CI)

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const allMode = argv.includes("--all");

// --- I/O accessors (staged vs disk) ---

/**
 * Returns the content of a repo-relative path from the correct snapshot.
 *
 * In default mode the git index is used (`git show :path`), so the result
 * reflects only staged changes and is unaffected by unstaged working-tree edits.
 * In --all mode the file is read from disk.
 *
 * @param {string} relPath - Repo-relative path (e.g. "src/lib/monty-sandbox.ts").
 * @returns {string} File content.
 */
function readSource(relPath) {
    if (allMode) {
        return readFileSync(join(ROOT, relPath), "utf8");
    }
    return execFileSync("git", ["show", `:${relPath}`], {
        cwd: ROOT,
        encoding: "utf8",
    });
}

/**
 * Returns the basenames of `.ts` files in `src/lib/ai-external-tools/` from
 * the correct snapshot.
 *
 * In default mode the git index is queried (`git ls-files --cached`) so that
 * newly staged but not-yet-committed files are included and deleted-but-staged
 * files are excluded.  In --all mode the directory is read from disk.
 *
 * @returns {string[]} Array of basenames (e.g. `["bam-mods.ts", "ls.ts", …]`).
 */
function listToolFiles() {
    const toolDir = "src/lib/ai-external-tools";
    if (allMode) {
        return readdirSync(join(ROOT, toolDir)).filter((f) =>
            f.endsWith(".ts"),
        );
    }
    const output = execFileSync(
        "git",
        ["ls-files", "--cached", `${toolDir}/`],
        { cwd: ROOT, encoding: "utf8" },
    );
    return output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((p) => basename(p))
        .filter((f) => f.endsWith(".ts"));
}

// --- Location 1: EXTERNAL_FUNCTIONS constant ---

/**
 * Extracts tool names from the EXTERNAL_FUNCTIONS array in ai-chat-constants.ts.
 * Finds the array by locating the EXTERNAL_FUNCTIONS identifier and capturing
 * all string literals between the opening `[` and the closing `] as const`.
 *
 * @returns {Set<string>} The set of tool names declared in the constant.
 */
function extractConstantNames() {
    const relPath = "src/lib/ai-chat-constants.ts";
    const source = readSource(relPath);

    // Match the EXTERNAL_FUNCTIONS identifier, then lazily capture the array body.
    const arrMatch = source.match(
        /\bEXTERNAL_FUNCTIONS\b[\s\S]*?\[\s*([\s\S]*?)\s*\]\s*as\s*const/,
    );
    if (!arrMatch) {
        throw new Error(
            `Could not locate EXTERNAL_FUNCTIONS array in ${relPath}`,
        );
    }

    const names = [...arrMatch[1].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
    if (names.length === 0) {
        throw new Error(
            `EXTERNAL_FUNCTIONS array appears to be empty in ${relPath}`,
        );
    }
    return new Set(names);
}

// --- Location 2: ai-external-tools folder ---

/**
 * Derives tool names from filenames in the ai-external-tools directory.
 * Skips index.ts and any *.test.ts files; converts kebab-case to snake_case.
 *
 * @returns {Set<string>} The set of tool names implied by the directory contents.
 */
function extractFolderNames() {
    const files = listToolFiles().filter(
        (f) => f !== "index.ts" && !f.endsWith(".test.ts"),
    );
    if (files.length === 0) {
        throw new Error(
            `No tool source files found in src/lib/ai-external-tools/`,
        );
    }
    return new Set(files.map((f) => basename(f, ".ts").replace(/-/g, "_")));
}

// --- Location 3: monty-sandbox.ts registration object ---

/**
 * Scans a JS/TS object literal body (starting just inside the opening brace)
 * and returns its top-level key names.
 *
 * Depth tracking with `{`, `(`, `[` pairs ensures that identifiers appearing
 * inside nested structures (e.g. arrow-function bodies passed as values) are
 * not mistaken for object keys.  Only identifiers that appear after pure
 * whitespace on their line at depth zero are treated as keys.
 *
 * The scan stops when the depth drops below zero, i.e. when the closing brace
 * of the outer object is consumed.
 *
 * @param {string} source    - Full source text of the file.
 * @param {number} bodyStart - Index of the first character inside the `{`.
 * @returns {Set<string>} The set of top-level key names.
 */
function extractTopLevelObjectKeys(source, bodyStart) {
    const keys = new Set();
    let depth = 0;
    let i = bodyStart;

    while (i < source.length) {
        const ch = source[i];

        if (ch === "{" || ch === "(" || ch === "[") {
            depth++;
        } else if (ch === "}" || ch === ")" || ch === "]") {
            depth--;
            // Depth below zero means we have consumed the outer object's `}`.
            if (depth < 0) break;
        } else if (depth === 0 && /[a-zA-Z_$]/.test(ch)) {
            // Candidate key: only accept identifiers that appear after pure
            // whitespace on their line (i.e. they start a new "key: value" entry).
            const lineStart = source.lastIndexOf("\n", i - 1) + 1;
            const beforeOnLine = source.slice(lineStart, i);
            if (/^\s*$/.test(beforeOnLine)) {
                const rest = source.slice(i);
                const m = rest.match(/^([a-zA-Z_$][\w$]*)\s*:/);
                if (m) {
                    keys.add(m[1]);
                    i += m[0].length;
                    continue;
                }
            }
        }

        i++;
    }

    return keys;
}

/**
 * Extracts tool names from the registration object in monty-sandbox.ts.
 *
 * Anchors on the `Object.fromEntries(` call that wraps the registration site,
 * then locates the next `Object.entries({` after it.  The `{` that closes the
 * `Object.entries(` marker is the opening brace of the registration object;
 * top-level keys are extracted with {@link extractTopLevelObjectKeys}.
 *
 * @returns {Set<string>} The set of tool names registered in the sandbox.
 */
function extractSandboxNames() {
    const relPath = "src/lib/monty-sandbox.ts";
    const source = readSource(relPath);

    // Use Object.fromEntries( as the anchor so we target the registration site
    // specifically, not the other Object.entries call in wrapForMonty.
    const anchorStr = "Object.fromEntries(";
    const anchorIdx = source.indexOf(anchorStr);
    if (anchorIdx === -1) {
        throw new Error(`Could not find "${anchorStr}" in ${relPath}`);
    }

    const entriesStr = "Object.entries({";
    const entriesIdx = source.indexOf(entriesStr, anchorIdx);
    if (entriesIdx === -1) {
        throw new Error(
            `Could not find "${entriesStr}" after anchor in ${relPath}`,
        );
    }

    // The `{` is the last character of entriesStr; body starts one past it.
    const bodyStart = entriesIdx + entriesStr.length;
    const keys = extractTopLevelObjectKeys(source, bodyStart);

    if (keys.size === 0) {
        throw new Error(`No keys found in registration object in ${relPath}`);
    }
    return keys;
}

// --- Comparison helpers ---

/**
 * Returns the names present in `a` but not `b`, and vice versa, both sorted.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {{ onlyInA: string[], onlyInB: string[] }}
 */
function diff(a, b) {
    return {
        onlyInA: [...a].filter((n) => !b.has(n)).sort(),
        onlyInB: [...b].filter((n) => !a.has(n)).sort(),
    };
}

// --- Main ---

let constantNames, folderNames, sandboxNames;
try {
    constantNames = extractConstantNames();
    folderNames = extractFolderNames();
    sandboxNames = extractSandboxNames();
} catch (e) {
    console.error(`check-external-tools-sync: parse error — ${e.message}`);
    process.exit(1);
}

// Sanity-check that the sandbox parser returned the foundational tools.
// These four names are stable primitives that must always be present; their
// absence most likely means the depth-tracking parser failed to locate the
// registration object rather than that someone intentionally removed a tool.
const SANDBOX_REQUIRED = ["ls", "read_file", "write_file", "continue_thinking"];
const missingRequired = SANDBOX_REQUIRED.filter((n) => !sandboxNames.has(n));
if (missingRequired.length > 0) {
    console.error(
        `check-external-tools-sync: extractSandboxNames is missing expected names — ` +
            `this likely indicates a parse failure, not an intentional removal.\n` +
            `  Missing: ${missingRequired.map((n) => `"${n}"`).join(", ")}\n` +
            `  Verify that the registration object in src/lib/monty-sandbox.ts ` +
            `is still structured as Object.fromEntries(Object.entries({…})).`,
    );
    process.exit(1);
}

/** @type {string[]} */
const errors = [];

/**
 * Compares two name sets and appends a human-readable diff to `errors` if
 * they differ.
 *
 * @param {Set<string>} a
 * @param {string}      labelA
 * @param {Set<string>} b
 * @param {string}      labelB
 */
function reportPair(a, labelA, b, labelB) {
    const { onlyInA, onlyInB } = diff(a, b);
    if (onlyInA.length === 0 && onlyInB.length === 0) return;
    errors.push(`  ✗ ${labelA}  vs  ${labelB}:`);
    for (const n of onlyInA) errors.push(`      only in ${labelA}: "${n}"`);
    for (const n of onlyInB) errors.push(`      only in ${labelB}: "${n}"`);
}

const LABEL_CONSTANT = "EXTERNAL_FUNCTIONS (ai-chat-constants.ts)";
const LABEL_FOLDER = "ai-external-tools/ files";
const LABEL_SANDBOX = "registration object (monty-sandbox.ts)";

reportPair(constantNames, LABEL_CONSTANT, folderNames, LABEL_FOLDER);
reportPair(constantNames, LABEL_CONSTANT, sandboxNames, LABEL_SANDBOX);
reportPair(folderNames, LABEL_FOLDER, sandboxNames, LABEL_SANDBOX);

if (errors.length > 0) {
    console.error("check-external-tools-sync FAILED:\n");
    for (const line of errors) console.error(line);
    console.error(
        "\nAll three locations must declare the same set of tool names.\n" +
            "When adding or removing a tool, update all of:\n" +
            "  1. EXTERNAL_FUNCTIONS in src/lib/ai-chat-constants.ts\n" +
            "  2. The tool file in src/lib/ai-external-tools/\n" +
            "  3. The registration object in src/lib/monty-sandbox.ts",
    );
    process.exit(1);
}

const total = constantNames.size;
console.log(
    `check-external-tools-sync PASSED — ${total} tool(s) consistent across all three locations.`,
);
