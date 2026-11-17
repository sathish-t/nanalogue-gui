#!/usr/bin/env node

// Production audit policy: the production dependency tree must have no
// advisories of any severity. There are no accepted exceptions.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Evaluates a production audit; throws unless the report is valid and clean. */
export function evaluateProductionAudit(stdout, status) {
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
    throw new Error(
        `Production audit failed: ${entries.length} finding(s): ${entries
            .map(([name, finding]) => `${name} (${finding?.severity})`)
            .join(", ")}.`,
    );
}

// Run the real npm audit in CI/local npm scripts; preserve failed reports for review.
if (
    process.argv[1] &&
    realpathSync(process.argv[1]) ===
        realpathSync(fileURLToPath(import.meta.url))
) {
    // npm prefers shrinkwrap; this policy audits the package-lock.json tree.
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
        console.log(evaluateProductionAudit(result.stdout, result.status));
    } catch (error) {
        console.error(error.message);
        console.error(result.stdout);
        console.error(result.stderr);
        process.exitCode = 1;
    }
}
