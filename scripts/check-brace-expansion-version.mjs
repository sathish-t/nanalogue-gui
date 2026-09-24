#!/usr/bin/env node

// Guards the production just-bash → minimatch → brace-expansion dependency
// chain against GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895. A live
// `npm audit` can start failing for unrelated advisories, so this check reads
// the committed lockfile and enforces the patched resolution deterministically.

import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const packages = lock.packages;

if (!packages || typeof packages !== "object") {
    throw new Error(
        "Brace-expansion advisory check: package-lock.json has no packages map",
    );
}

const justBash = packages["node_modules/just-bash"];
const minimatch = packages["node_modules/minimatch"];
const braceExpansion = packages["node_modules/brace-expansion"];
const nestedMinimatch =
    packages["node_modules/just-bash/node_modules/minimatch"];
const nestedBraceExpansion =
    packages["node_modules/minimatch/node_modules/brace-expansion"];

if (
    !justBash?.dependencies?.minimatch ||
    !minimatch?.dependencies?.["brace-expansion"] ||
    typeof braceExpansion?.version !== "string"
) {
    throw new Error(
        "Brace-expansion advisory check: expected production chain just-bash → minimatch → brace-expansion was not found",
    );
}

if (nestedMinimatch || nestedBraceExpansion) {
    throw new Error(
        "Brace-expansion advisory check: dependency layout changed; update this check to inspect the nested just-bash resolution",
    );
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(braceExpansion.version);
if (!match) {
    throw new Error(
        `Brace-expansion advisory check: resolved version ${braceExpansion.version} is not a stable release`,
    );
}

const [, majorText, minorText, patchText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);
const isPatched =
    major > 5 || (major === 5 && (minor > 0 || (minor === 0 && patch >= 9)));

if (!isPatched) {
    throw new Error(
        `Brace-expansion advisory check: resolved version ${braceExpansion.version} is vulnerable; use 5.0.9 or newer`,
    );
}

console.log(
    `Brace-expansion advisory check passed (resolved ${braceExpansion.version}).`,
);
