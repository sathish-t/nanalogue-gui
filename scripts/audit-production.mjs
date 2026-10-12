#!/usr/bin/env node

// Temporary risk acceptance approved for GHSA-hp3w-g68c-fv3c only.
// No patched sprintf-js release is available. The locked just-bash printf
// fallback imports it. Precision-error tests do NOT establish protection from
// large allocations / denial of service. This exception is not a mitigation.
// Remove when a reviewed fix is available; never silently extend the deadline.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ADVISORY = "https://github.com/advisories/GHSA-hp3w-g68c-fv3c";
const EXPIRES = "2026-11-11T00:00:00.000Z";
const LOCKED_VERSIONS = { "just-bash": "2.14.2", "sprintf-js": "1.1.3" };

/** Evaluates a production audit; throws unless clean or exactly approved before UTC expiry. */
export function evaluateProductionAudit(
    stdout,
    status,
    lock,
    now = new Date(),
) {
    let report;
    try {
        report = JSON.parse(stdout);
    } catch {
        throw new Error("Production audit failed: invalid JSON response.");
    }
    if (
        ![0, 1].includes(status) ||
        report?.error ||
        report?.auditReportVersion !== 2 ||
        !report.vulnerabilities ||
        typeof report.vulnerabilities !== "object" ||
        Array.isArray(report.vulnerabilities)
    ) {
        throw new Error(
            "Production audit failed: command error or invalid report.",
        );
    }
    const entries = Object.entries(report.vulnerabilities);
    const counts = report.metadata?.vulnerabilities;
    for (const severity of ["info", "low", "moderate", "high", "critical"]) {
        if (
            counts?.[severity] !==
            entries.filter(([, finding]) => finding?.severity === severity)
                .length
        ) {
            throw new Error(
                "Production audit failed: inconsistent vulnerability counts.",
            );
        }
    }
    if (
        counts.total !== entries.length ||
        status !== (entries.length ? 1 : 0)
    ) {
        throw new Error(
            "Production audit failed: inconsistent total or exit code.",
        );
    }
    if (entries.length === 0)
        return "Production audit passed: no vulnerabilities.";

    // Require exactly the reviewed two-entry chain, not all moderate findings.
    if (
        entries.length !== 2 ||
        !Number.isFinite(now.getTime()) ||
        now >= new Date(EXPIRES)
    ) {
        throw new Error(
            "Production audit failed: unapproved findings or exception expired.",
        );
    }
    for (const [name, finding] of entries) {
        const node = `node_modules/${name}`;
        const via = finding?.via;
        const expectedEffects = name === "sprintf-js" ? ["just-bash"] : [];
        if (
            !Object.hasOwn(LOCKED_VERSIONS, name) ||
            finding?.name !== name ||
            finding.severity !== "moderate" ||
            finding.isDirect !== (name === "just-bash") ||
            // '*' records the reviewed npm release inventory; narrower/empty
            // ranges require review even when npm cannot calculate a fix.
            finding.range !== "*" ||
            finding.fixAvailable !== false ||
            JSON.stringify(finding.nodes) !== JSON.stringify([node]) ||
            JSON.stringify(finding.effects) !==
                JSON.stringify(expectedEffects) ||
            lock?.packages?.[node]?.version !== LOCKED_VERSIONS[name] ||
            !Array.isArray(via) ||
            via.length !== 1 ||
            (name === "just-bash"
                ? via[0] !== "sprintf-js"
                : via[0]?.url !== ADVISORY ||
                  via[0]?.name !== "sprintf-js" ||
                  via[0]?.dependency !== "sprintf-js" ||
                  via[0]?.range !== "<=1.1.3" ||
                  via[0]?.severity !== "moderate")
        ) {
            throw new Error(
                `Production audit failed: unapproved finding for ${name}.`,
            );
        }
    }
    if (
        lock.packages["node_modules/just-bash"].dependencies?.["sprintf-js"] !==
        "^1.1.3"
    ) {
        throw new Error("Production audit failed: dependency chain changed.");
    }
    return `Production audit exception: GHSA-hp3w-g68c-fv3c in just-bash@2.14.2 -> sprintf-js@1.1.3; expires ${EXPIRES}. Denial-of-service risk remains accepted, not fixed.`;
}

// Run the real npm audit in CI/local npm scripts; preserve failed reports for review.
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    // npm prefers shrinkwrap, but our version checks read package-lock.json.
    if (existsSync(new URL("../npm-shrinkwrap.json", import.meta.url))) {
        console.error(
            "Production audit failed: npm-shrinkwrap.json overrides package-lock.json; remove the alternative lockfile before auditing.",
        );
        process.exit(1);
    }
    const result = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
            "audit",
            "--omit=dev",
            "--include=optional",
            "--offline=false",
            "--package-lock=true",
            "--audit-level=info",
            "--json",
        ],
        {
            cwd: ROOT,
            encoding: "utf8",
            shell: process.platform === "win32",
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
        },
    );
    try {
        if (result.error || result.signal) {
            throw new Error("Production audit failed: npm could not complete.");
        }
        const lock = JSON.parse(
            readFileSync(
                new URL("../package-lock.json", import.meta.url),
                "utf8",
            ),
        );
        console.log(
            evaluateProductionAudit(result.stdout, result.status, lock),
        );
    } catch (error) {
        console.error(error.message);
        console.error(result.stdout);
        console.error(result.stderr);
        process.exitCode = 1;
    }
}
