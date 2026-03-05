#!/usr/bin/env node

// Checks all non-gitignored markdown files in the repository for two kinds
// of stale references:
//   1. Broken markdown links ([text](path)) — internal targets are resolved
//      and checked; directory links are valid if the directory contains at
//      least one non-gitignored file.
//   2. Stale TypeScript file paths — inline code spans (e.g. `src/lib/foo.ts`)
//      that start with "src/" and end with ".ts" are resolved from the repo
//      root and checked against the non-gitignored file set.
// External links (http, https, ftp, mailto, etc.) are intentionally never
// checked — fetching external URLs is a security risk.
// A target is considered valid only if it is present on disk and not
// gitignored. Links into gitignored paths (e.g. docs/) are reported as broken
// because they will not exist in a clean clone.
// Exits 0 if all references resolve, 1 if any are broken.
// Run: node scripts/check-md-links.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- File discovery ---

// When --cached-only is passed (used by the pre-commit hook), only staged and
// already-committed files are checked. Untracked files are excluded so that
// local draft markdown files cannot block unrelated commits.
const cachedOnly = argv.includes("--cached-only");

/**
 * Returns two sets derived from the list of non-gitignored files:
 *
 *   files  — absolute paths of every non-gitignored file.
 *   dirs   — absolute paths of every directory that is an ancestor of at
 *            least one non-gitignored file (down to ROOT). A link to a
 *            directory is valid when that directory appears in this set,
 *            meaning it contains reachable content. Gitignored directories
 *            (e.g. docs/) will be absent and treated as broken.
 *
 * @returns {{ files: Set<string>, dirs: Set<string> }}
 */
function getNonIgnoredFilesAndDirs() {
    const args = cachedOnly
        ? ["ls-files", "--cached"]
        : ["ls-files", "--cached", "--others", "--exclude-standard"];
    const output = execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

    // In default mode, filter to files that actually exist on disk: --cached
    // can list tracked files that have been deleted in the working tree but not
    // yet staged. In --cached-only mode we trust the index directly and must NOT
    // apply existsSync — files present in the index but missing from the working
    // tree are still valid link targets for the commit being validated.
    const files = new Set(
        output
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((f) => join(ROOT, f))
            .filter((f) => cachedOnly || existsSync(f)),
    );

    // Derive every ancestor directory of each non-gitignored file, up to and
    // including ROOT itself, so that links resolving to the repo root (e.g.
    // `/`, `./`, or `../` from a subdirectory) are treated as valid.
    const dirs = new Set([ROOT]);
    for (const filePath of files) {
        let dir = dirname(filePath);
        while (dir.startsWith(ROOT) && dir !== ROOT) {
            if (dirs.has(dir)) break; // already walked this branch
            dirs.add(dir);
            dir = dirname(dir);
        }
    }

    return { files, dirs };
}

// --- Code-block stripping ---

/**
 * Removes fenced code blocks from markdown, replacing them with blank lines
 * to preserve line count. Inline code spans are left intact.
 *
 * @param {string} content raw markdown
 * @returns {string} content with fenced blocks blanked out
 */
function stripFencedBlocks(content) {
    const lines = content.split("\n");
    const result = [];
    let inFence = false;

    for (const line of lines) {
        if (/^```/.test(line.trimStart())) {
            inFence = !inFence;
            result.push(""); // preserve line count
            continue;
        }
        result.push(inFence ? "" : line);
    }

    return result.join("\n");
}

/**
 * Removes fenced code blocks and inline code spans from markdown so that
 * path-like strings inside them are not mistaken for link targets.
 *
 * @param {string} content raw markdown
 * @returns {string} content with all code sections blanked out
 */
function stripCode(content) {
    return stripFencedBlocks(content).replace(/`[^`\n]+`/g, "``");
}

// --- Link extraction ---

/**
 * Returns true if a link target should be validated (i.e. it is an internal
 * filesystem path: not empty, not a bare anchor, and not a URI scheme).
 *
 * @param {string} target
 * @returns {boolean}
 */
function isInternal(target) {
    if (!target) return false;
    if (target.startsWith("#")) return false; // bare anchor within same file
    if (target.startsWith("//")) return false; // protocol-relative URL
    // Any URI scheme (http, https, ftp, mailto, data, …) — skip
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(target)) return false;
    return true;
}

/**
 * Extracts all internal link targets from a markdown string.
 * Handles inline links ([text](target)), image links (![alt](target)),
 * and reference-style link definitions ([label]: target).
 * Anchors are stripped from paths before returning.
 *
 * @param {string} content raw markdown
 * @returns {string[]} deduplicated internal link targets (path only, no anchor)
 */
function extractInternalLinks(content) {
    const stripped = stripCode(content);
    const targets = new Set();

    // Inline and image links: [text](target) / ![alt](target)
    // The captured group may include an optional title after the path
    // (e.g. `ARCHITECTURE.md "My Title"`), so we split on whitespace and
    // take only the first token before stripping any anchor fragment.
    const inlineRe = /!?\[[^\]]*\]\(([^)\s][^)]*)\)/g;
    for (const match of stripped.matchAll(inlineRe)) {
        const target = match[1].split(/\s+/)[0].split("#")[0].trim();
        if (isInternal(target)) targets.add(target);
    }

    // Reference-style link definitions: [label]: target
    const refRe = /^\[[^\]]+\]:\s+(\S+)/gm;
    for (const match of stripped.matchAll(refRe)) {
        const target = match[1].split("#")[0].trim();
        if (isInternal(target)) targets.add(target);
    }

    return [...targets];
}

// --- Inline code TypeScript path extraction ---

/**
 * Extracts inline code spans (outside fenced blocks) whose content looks like
 * a TypeScript source file path — i.e. starts with "src/" and ends with ".ts".
 * These are treated as implicit file references and validated against the
 * non-gitignored file set. Paths are repo-relative (resolved from ROOT).
 *
 * @param {string} content raw markdown
 * @returns {string[]} deduplicated repo-relative paths found in inline code
 */
function extractInlineCodeTsPaths(content) {
    const withoutFences = stripFencedBlocks(content);
    const paths = new Set();
    const re = /`([^`\n]+)`/g;
    for (const match of withoutFences.matchAll(re)) {
        const text = match[1].trim();
        if (text.startsWith("src/") && text.endsWith(".ts")) {
            paths.add(text);
        }
    }
    return [...paths];
}

// --- Per-file check ---

/**
 * Returns the content of a markdown file to validate.
 *
 * In default mode, reads from the working tree with `readFileSync`.
 * In `--cached-only` mode (pre-commit), reads the staged blob via
 * `git show :path` so that unstaged working-tree edits cannot cause
 * false passes or false failures against the content actually being committed.
 *
 * @param {string} filePath absolute path to the file
 * @returns {string} file content
 */
function readContent(filePath) {
    if (cachedOnly) {
        // git show expects forward slashes in the path regardless of platform.
        const relPath = relative(ROOT, filePath).replace(/\\/g, "/");
        return execFileSync("git", ["show", `:${relPath}`], {
            cwd: ROOT,
            encoding: "utf8",
        });
    }
    return readFileSync(filePath, "utf8");
}

/**
 * Checks all internal links and inline-code TypeScript paths in a markdown
 * file and returns any that are broken.
 *
 * A markdown link target is valid if it resolves to either a non-gitignored
 * file (present in validFiles) or a directory that contains at least one
 * non-gitignored file (present in validDirs).
 *
 * An inline-code TypeScript path (starts with "src/", ends with ".ts") is
 * valid if it resolves from ROOT to a non-gitignored file in validFiles.
 *
 * @param {string} filePath absolute path to the markdown file
 * @param {Set<string>} validFiles set of absolute file paths considered reachable
 * @param {Set<string>} validDirs set of absolute directory paths considered reachable
 * @returns {string[]} broken link targets and broken TS paths
 */
function checkFile(filePath, validFiles, validDirs) {
    const content = readContent(filePath);
    const dir = dirname(filePath);
    const broken = [];

    // Check markdown links.
    // All links are resolved with path.resolve, which normalises separators and
    // strips trailing slashes. Root-relative links (starting with /) are resolved
    // from ROOT; relative links are resolved from the file's directory.
    for (const link of extractInternalLinks(content)) {
        const abs = link.startsWith("/")
            ? resolve(ROOT, link.slice(1))
            : resolve(dir, link);
        if (!validFiles.has(abs) && !validDirs.has(abs)) {
            broken.push(link);
        }
    }

    // Check inline-code TypeScript paths (repo-relative, resolved from ROOT)
    for (const tsPath of extractInlineCodeTsPaths(content)) {
        if (!validFiles.has(join(ROOT, tsPath))) {
            broken.push(tsPath);
        }
    }

    return broken;
}

// --- Main ---

const { files: validFiles, dirs: validDirs } = getNonIgnoredFilesAndDirs();
const mdFiles = [...validFiles].filter((f) => f.endsWith(".md"));
const passed = [];
const failed = [];

for (const filePath of mdFiles) {
    const broken = checkFile(filePath, validFiles, validDirs);
    const rel = relative(ROOT, filePath);
    if (broken.length === 0) {
        passed.push(rel);
    } else {
        failed.push({ file: rel, broken });
    }
}

if (failed.length === 0) {
    for (const f of passed) {
        console.log(`  ✓ ${f}`);
    }
    console.log(
        `\nMarkdown link check passed across ${passed.length} file(s).`,
    );
    process.exit(0);
} else {
    console.error("Markdown link check FAILED.\n");
    console.error("Failed files:");
    for (const { file, broken } of failed) {
        console.error(`  ✗ ${file}`);
        for (const link of broken) {
            console.error(`      broken link: "${link}"`);
        }
    }
    if (passed.length > 0) {
        console.error("\nPassed files:");
        for (const f of passed) {
            console.error(`  ✓ ${f}`);
        }
    }
    process.exit(1);
}
