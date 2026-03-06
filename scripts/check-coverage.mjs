#!/usr/bin/env node

// Enforces a coverage floor stored in documentation/script-coverage.tsv.
//
// Rules:
//   - Every pre-existing tracked file must have current %Lines >= stored %Lines.
//   - Every brand-new file (not yet in the TSV) must debut at 100% %Lines.
//   - A tracked file that is absent from coverage output AND still exists on
//     disk is treated as a hard failure (its tests were likely removed).
//   - A tracked file that has been deleted from disk is silently retired from
//     the TSV (source file gone, floor entry no longer meaningful).
//   - When all checks pass the TSV is updated in-place with the current values
//     (so a file whose coverage rises permanently raises the floor).
//   - When the TSV does not yet exist it is created from current coverage.
//
// Run: node scripts/check-coverage.mjs
// (Also invoked by the pre-commit hook and CI.)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TSV_PATH = join(ROOT, "documentation", "script-coverage.tsv");
const SUMMARY_PATH = join(ROOT, "coverage", "coverage-summary.json");

// --- Run vitest with coverage ---

console.log("Running vitest coverage…");
try {
    execFileSync(
        "npx",
        ["vitest", "run", "--coverage", "--coverage.reporter=json-summary"],
        { cwd: ROOT, stdio: "inherit" },
    );
} catch {
    // vitest exits non-zero when tests fail; the coverage JSON may still have
    // been written, but we should not update the floor from a failing run.
    console.error("vitest run failed — aborting coverage check.");
    process.exit(1);
}

// --- Parse coverage-summary.json ---

if (!existsSync(SUMMARY_PATH)) {
    console.error(`Coverage summary not found at ${SUMMARY_PATH}`);
    process.exit(1);
}

/** @type {Record<string, { lines: { pct: number } }>} */
const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf-8"));

// Build a map of relative path -> %lines for TypeScript source files only.
// We skip non-.ts entries (e.g. package.json) which v8 occasionally instruments.
/** @type {Map<string, number>} */
const current = new Map();
for (const [absPath, data] of Object.entries(summary)) {
    if (absPath === "total") continue;
    if (!absPath.endsWith(".ts")) continue;
    const rel = relative(ROOT, absPath);
    current.set(rel, data.lines.pct);
}

// --- Bootstrap: create TSV if it does not exist ---

if (!existsSync(TSV_PATH)) {
    const rows = ["filename\t%lines"];
    for (const [file, pct] of [...current.entries()].sort()) {
        rows.push(`${file}\t${pct}`);
    }
    writeFileSync(TSV_PATH, `${rows.join("\n")}\n`);
    console.log(
        `Created ${TSV_PATH} with ${current.size} file(s). All future runs will enforce these values as a floor.`,
    );
    process.exit(0);
}

// --- Parse existing TSV ---

const tsvContent = readFileSync(TSV_PATH, "utf-8");
const tsvLines = tsvContent.split("\n").filter((l) => l.trim().length > 0);

// Skip header row
/** @type {Map<string, number>} */
const stored = new Map();
for (const line of tsvLines.slice(1)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const file = line.slice(0, tab).trim();
    const pct = parseFloat(line.slice(tab + 1).trim());
    if (!file) continue;
    if (!Number.isFinite(pct)) {
        console.warn(
            `  WARNING: skipping malformed TSV row (non-numeric %lines): ${line}`,
        );
        continue;
    }
    stored.set(file, pct);
}

// --- Compare ---

const errors = [];

// 1. Pre-existing files must not regress.
for (const [file, storedPct] of stored.entries()) {
    const currentPct = current.get(file);
    if (currentPct === undefined) {
        // File is absent from coverage output.  If the source file itself has
        // been deleted that is intentional; retire it from the floor table
        // silently.  If the file still exists on disk, its tests were likely
        // removed — treat that as a hard failure.
        if (existsSync(join(ROOT, file))) {
            errors.push(
                `MISSING FROM COVERAGE  ${file}: file exists on disk but produced no coverage data (were its tests removed?)`,
            );
        }
        continue;
    }
    if (currentPct < storedPct) {
        errors.push(
            `REGRESSION  ${file}: ${currentPct}% < floor ${storedPct}%`,
        );
    }
}

// 2. Brand-new files must debut at 100%.
for (const [file, currentPct] of current.entries()) {
    if (!stored.has(file) && currentPct < 100) {
        errors.push(`NEW FILE BELOW 100%  ${file}: ${currentPct}%`);
    }
}

// --- Report failures ---

if (errors.length > 0) {
    console.error("\nCoverage check FAILED:\n");
    for (const msg of errors) {
        console.error(`  ✗ ${msg}`);
    }
    process.exit(1);
}

// --- All checks passed: update TSV ---
// The new floor is exactly the current coverage output.  Deleted files are
// retired by omission; files that caused a hard failure above are never
// reached here.
/** @type {Map<string, number>} */
const merged = new Map(current);

const updatedRows = ["filename\t%lines"];
for (const [file, pct] of [...merged.entries()].sort()) {
    updatedRows.push(`${file}\t${pct}`);
}
writeFileSync(TSV_PATH, `${updatedRows.join("\n")}\n`);
console.log(
    `\nCoverage check PASSED. ${TSV_PATH} updated with ${merged.size} file(s).`,
);
