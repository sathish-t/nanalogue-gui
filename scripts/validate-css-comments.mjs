#!/usr/bin/env node
// Validates that every top-level CSS ruleset in src/ has a /* comment */
// on the line immediately above it. Exits 0 if valid, 1 if not.
// Run: node scripts/validate-css-comments.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "src");

// --- File discovery ---

/** Recursively collect all .css files under a directory. */
function collectCssFiles(dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            results.push(...collectCssFiles(full));
        } else if (extname(entry) === ".css") {
            results.push(full);
        }
    }
    return results;
}

// --- Per-file validation ---

/**
 * Validates that every top-level ruleset in a CSS file has a comment on the
 * line immediately above it.
 *
 * Strategy: walk lines tracking brace depth and whether we are inside a
 * /* ... *\/ comment. When a non-blank, non-comment line is encountered at
 * depth 0 (i.e. the start of a new ruleset selector), the line directly
 * above it must end with *\/ — the close of a comment.
 *
 * "Immediately above" is strict: a blank line between comment and selector
 * is treated as a missing comment.
 *
 * @param {string} filePath
 * @returns {string[]} error messages
 */
function validateFile(filePath) {
    const content = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
    const lines = content.split("\n");
    const rel = relative(ROOT, filePath);
    const errors = [];

    let depth = 0;
    let inComment = false;
    // 'BETWEEN' = between rulesets | 'SELECTOR' = collecting selector lines | 'BLOCK' = inside {}
    let state = "BETWEEN";

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // --- Multi-line comment tracking ---
        // If we are inside a /* ... */ comment, skip until we see the closing */.
        if (inComment) {
            if (trimmed.includes("*/")) inComment = false;
            continue;
        }
        // Start of a /* comment — if it doesn't close on the same line, enter comment mode.
        if (trimmed.startsWith("/*")) {
            if (!trimmed.includes("*/")) inComment = true;
            // Comment lines are invisible to the state machine.
            continue;
        }

        // --- Brace counting (strip any inline /* ... */ before counting) ---
        const forCounting = trimmed.replace(/\/\*.*?\*\//g, "");
        const opens = (forCounting.match(/{/g) ?? []).length;
        const closes = (forCounting.match(/}/g) ?? []).length;

        // --- State machine ---
        if (state === "BETWEEN") {
            if (trimmed === "") {
                // Blank line — stay between rulesets.
            } else {
                // First line of a new selector group. The line directly above (lines[i-1])
                // must be a comment line (trimmed, ending with */).
                const prev = i > 0 ? lines[i - 1].trim() : "";
                if (!prev.endsWith("*/")) {
                    errors.push(
                        `${rel}:${i + 1}: missing comment above "${trimmed.slice(0, 60)}"`,
                    );
                }
                if (opens > closes) {
                    depth += opens - closes;
                    state = "BLOCK";
                } else {
                    state = "SELECTOR"; // multi-line selector, { not yet seen
                }
            }
        } else if (state === "SELECTOR") {
            // Continuation lines of a multi-selector rule — wait for the opening {.
            if (opens > 0) {
                depth += opens - closes;
                state = "BLOCK";
            }
        } else {
            // state === 'BLOCK'
            depth += opens - closes;
            if (depth === 0) state = "BETWEEN";
        }
    }

    return errors;
}

// --- Main ---

const cssFiles = collectCssFiles(SRC_DIR);
const allErrors = cssFiles.flatMap(validateFile);

if (allErrors.length > 0) {
    console.error("CSS comment validation failed:\n");
    for (const e of allErrors) {
        console.error(`  ✗ ${e}`);
    }
    process.exit(1);
} else {
    for (const f of cssFiles) {
        console.log(`  ✓ ${relative(ROOT, f)}`);
    }
    console.log(`\nCSS comments valid across ${cssFiles.length} file(s).`);
}
