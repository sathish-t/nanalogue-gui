#!/usr/bin/env node
// Checks for empty JSDoc comments of the form /\*\* \*\/ or /\*\* \* \*\/ and
// any variation where the content between the opening and closing markers
// consists only of whitespace and asterisks. Biome sometimes leaves these
// behind when stripping doc content. Exits 0 if none found, 1 if any found.
// Run: node scripts/check-empty-jsdoc.mjs

import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** Directories to scan. */
const SCAN_DIRS = ["src", "scripts", "demo"].map((d) => join(ROOT, d));

/** File extensions to check. */
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/**
 * Matches an empty JSDoc comment: opening marker followed by any combination
 * of whitespace and asterisks, followed by the closing marker.
 */
const EMPTY_JSDOC = /\/\*\*[\s*]*\*\//g;

/** Recursively collect all files with a relevant extension under a directory. */
function collectFiles(dir) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFiles(full));
        } else if (EXTENSIONS.has(extname(entry.name))) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Scans a single file for empty JSDoc comments.
 *
 * @param {string} filePath
 * @returns {{ file: string, line: number, match: string }[]}
 */
function checkFile(filePath) {
    const content = readFileSync(filePath, "utf-8");
    const findings = [];
    EMPTY_JSDOC.lastIndex = 0;
    let m = EMPTY_JSDOC.exec(content);
    while (m !== null) {
        const line = content.slice(0, m.index).split("\n").length;
        findings.push({
            file: relative(ROOT, filePath),
            line,
            match: m[0].replace(/\n/g, "\\n"),
        });
        m = EMPTY_JSDOC.exec(content);
    }
    return findings;
}

// --- Main ---

const files = SCAN_DIRS.flatMap(collectFiles);
const allFindings = files.flatMap(checkFile);

if (allFindings.length > 0) {
    console.error("Empty JSDoc comments found:\n");
    for (const { file, line, match } of allFindings) {
        console.error(`  ✗  ${file}:${line}  ${match}`);
    }
    console.error(`\nRemove or fill in these comments before committing.`);
    process.exit(1);
} else {
    console.log(
        `  ✓  No empty JSDoc comments found across ${files.length} file(s).`,
    );
}
