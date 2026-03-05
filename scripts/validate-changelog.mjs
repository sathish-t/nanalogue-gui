#!/usr/bin/env node

// Validates CHANGELOG.md format. Exits 0 if valid, 1 if not.
// Run: node scripts/validate-changelog.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");

// --- Constants ---

const REQUIRED_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).`;

const ALLOWED_SUBHEADINGS = new Set([
    "Added",
    "Changed",
    "Dependencies",
    "Fixed",
    "Infrastructure",
    "Removed",
    "Security",
]);

const REPO_COMMIT_URL = "https://github.com/sathish-t/nanalogue-gui/commit/";

// Matches ## [Unreleased]
const UNRELEASED_RE = /^\[Unreleased\]$/;
// Matches ## [x.x.x] - YYYY-MM-DD; each version part may be multi-digit
const VERSION_RE = /^\[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/;
// Strict valid commit ref: [`<7hex>`](https://github.com/sathish-t/nanalogue-gui/commit/<40hex>)
const STRICT_COMMIT_RE =
    /^\[`[a-f0-9]{7}`\]\(https:\/\/github\.com\/sathish-t\/nanalogue-gui\/commit\/[a-f0-9]{40}\)$/;
// Finds anything that looks like a commit ref attempt: backtick-quoted hex display text
// paired with a URL containing /commit/. More specific than a generic link scan so it
// does not false-positive on CHANGELOG prose that happens to contain brackets and slashes.
const COMMIT_ATTEMPT_RE =
    /\[`([a-f0-9]+)`\]\(https?:\/\/[^)]*\/commit\/[^)]*\)/g;
// Extracts display SHA and URL SHA from a valid commit ref (for existence checks)
const COMMIT_REF_RE =
    /\[`([a-f0-9]{7})`\]\(https:\/\/github\.com\/sathish-t\/nanalogue-gui\/commit\/([a-f0-9]{40})\)/g;

// --- Helpers ---

const errors = [];
function error(msg) {
    errors.push(msg);
}

// Memoised commit existence check using execFileSync to avoid shell invocation.
const commitCache = new Map();
function commitExists(sha) {
    if (commitCache.has(sha)) return commitCache.get(sha);
    try {
        execFileSync("git", ["rev-parse", "--verify", `${sha}^{commit}`], {
            stdio: "pipe",
            cwd: ROOT,
        });
        commitCache.set(sha, true);
        return true;
    } catch (err) {
        // ENOENT means git binary is not on PATH — propagate as a hard error
        if (err.code === "ENOENT") {
            throw new Error("git is not available on PATH");
        }
        // Any exit status other than 128 is an unexpected git failure — propagate
        if (err.status !== 128) {
            throw new Error(
                `git rev-parse failed unexpectedly (exit ${err.status}): ` +
                    (err.stderr?.toString().trim() ?? ""),
            );
        }
        // Exit status 128 means the commit is not found
        commitCache.set(sha, false);
        return false;
    }
}

// --- Read and normalise file ---

let content;
try {
    content = readFileSync(CHANGELOG_PATH, "utf-8");
} catch {
    console.error("validate-changelog: could not read CHANGELOG.md");
    process.exit(1);
}

// Normalise Windows line endings so all checks work on any platform
content = content.replace(/\r\n/g, "\n");

// --- 1. Header check ---

if (!content.startsWith(REQUIRED_HEADER)) {
    error("File does not start with the required header block");
}

// --- 2. Parse ## sections ---

const lines = content.split("\n");

/** @type {{ title: string, lineNo: number, bodyLines: string[] }[]} */
const sections = [];
let current = null;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
        if (current) sections.push(current);
        current = { title: line.slice(3).trim(), lineNo: i + 1, bodyLines: [] };
    } else if (current) {
        current.bodyLines.push(line);
    }
}
if (current) sections.push(current);

// --- 3. Validate ## headings ---

if (sections.length === 0) {
    error("No ## sections found");
}

// [Unreleased] must be present, exactly once, and first
const unreleasedCount = sections.filter((s) =>
    UNRELEASED_RE.test(s.title),
).length;
if (unreleasedCount === 0) {
    error("No ## [Unreleased] section found — exactly one is required");
} else if (unreleasedCount > 1) {
    error(
        `Found ${unreleasedCount} ## [Unreleased] sections — exactly one is required`,
    );
}
if (sections.length > 0 && !UNRELEASED_RE.test(sections[0].title)) {
    error(
        `Line ${sections[0].lineNo}: ## [${sections[0].title}] appears before ## [Unreleased] — ` +
            `[Unreleased] must be the first ## section`,
    );
}

// Version headings must be valid and unique
const versionsSeen = new Set();
for (const section of sections) {
    if (UNRELEASED_RE.test(section.title)) continue;
    if (!VERSION_RE.test(section.title)) {
        error(
            `Line ${section.lineNo}: invalid ## heading "[${section.title}]" — ` +
                `must be [Unreleased] or [x.x.x] - YYYY-MM-DD`,
        );
        continue;
    }
    if (versionsSeen.has(section.title)) {
        error(
            `Line ${section.lineNo}: duplicate version heading [${section.title}]`,
        );
    }
    versionsSeen.add(section.title);
}

// --- 4. Validate ### subsections within each ## section ---

for (const section of sections) {
    const isUnreleased = UNRELEASED_RE.test(section.title);

    /** @type {{ title: string, lineNo: number, bodyLines: string[] }[]} */
    const subs = [];
    let currentSub = null;

    for (let i = 0; i < section.bodyLines.length; i++) {
        const line = section.bodyLines[i];
        if (line.startsWith("### ")) {
            if (currentSub) subs.push(currentSub);
            currentSub = {
                title: line.slice(4).trim(),
                lineNo: section.lineNo + i + 1,
                bodyLines: [],
            };
        } else if (currentSub) {
            currentSub.bodyLines.push(line);
        }
    }
    if (currentSub) subs.push(currentSub);

    // Versioned sections must have at least one ### heading
    if (!isUnreleased && subs.length === 0) {
        error(
            `Line ${section.lineNo}: ## [${section.title}] has no ### subheadings — ` +
                `versioned sections must have at least one`,
        );
    }

    const seen = new Set();
    for (const sub of subs) {
        if (!ALLOWED_SUBHEADINGS.has(sub.title)) {
            error(
                `Line ${sub.lineNo}: unknown ### heading "${sub.title}" in ## [${section.title}] — ` +
                    `allowed: ${[...ALLOWED_SUBHEADINGS].join(", ")}`,
            );
        }
        if (seen.has(sub.title)) {
            error(
                `Line ${sub.lineNo}: duplicate ### ${sub.title} in ## [${section.title}]`,
            );
        }
        seen.add(sub.title);

        const bullets = sub.bodyLines.filter((l) => l.trim().startsWith("-"));
        if (bullets.length === 0) {
            error(
                `Line ${sub.lineNo}: ### ${sub.title} in ## [${section.title}] ` +
                    `has no hyphen-bulleted content`,
            );
        }
    }
}

// --- 5. Validate commit references ---

// Secondary scan: anything that looks like a commit ref attempt must match the strict format
COMMIT_ATTEMPT_RE.lastIndex = 0;
for (const anyMatch of content.matchAll(COMMIT_ATTEMPT_RE)) {
    if (!STRICT_COMMIT_RE.test(anyMatch[0])) {
        error(
            `Malformed commit link (must be [\`<7hex>\`](${REPO_COMMIT_URL}<40hex>)): ` +
                anyMatch[0].slice(0, 100),
        );
    }
}

// Primary scan: check display SHA matches URL SHA, and commit exists in repo
COMMIT_REF_RE.lastIndex = 0;
for (const match of content.matchAll(COMMIT_REF_RE)) {
    const displaySha = match[1];
    const urlSha = match[2];

    if (!urlSha.startsWith(displaySha)) {
        error(
            `Commit ref [\`${displaySha}\`]: display hash does not match ` +
                `the full SHA in the URL (${urlSha})`,
        );
    }

    if (!commitExists(urlSha)) {
        error(
            `Commit ref [\`${displaySha}\`]: ${urlSha} does not exist in this repository`,
        );
    }
}

// --- Report ---

if (errors.length > 0) {
    console.error("CHANGELOG.md validation failed:\n");
    for (const e of errors) {
        console.error(`  ✗ ${e}`);
    }
    process.exit(1);
} else {
    console.log("CHANGELOG.md is valid.");
}
