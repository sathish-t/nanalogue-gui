// Production audit policy: any finding in the production tree fails the audit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateProductionAudit } from "./audit-production.mjs";

/** Builds a well-formed npm audit report containing the given findings. */
function report(findings = {}) {
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    for (const finding of Object.values(findings)) counts[finding.severity]++;
    return {
        auditReportVersion: 2,
        vulnerabilities: findings,
        metadata: {
            vulnerabilities: {
                ...counts,
                total: Object.keys(findings).length,
            },
        },
    };
}

const finding = (name, severity = "moderate") => ({ name, severity });
const check = (r, status) => evaluateProductionAudit(JSON.stringify(r), status);

test("a clean production audit passes", () => {
    assert.match(check(report(), 0), /no vulnerabilities/);
});

test("any finding fails, whatever its severity", () => {
    for (const severity of ["info", "low", "moderate", "high", "critical"]) {
        assert.throws(
            () => check(report({ pkg: finding("pkg", severity) }), 1),
            new RegExp(
                `Production audit failed: 1 finding\\(s\\): pkg \\(${severity}\\)`,
            ),
        );
    }
});

test("fails closed on audit errors, malformed reports and inconsistent exit codes/counts", () => {
    const one = () => report({ pkg: finding("pkg") });
    for (const status of [null, 2, 0]) {
        assert.throws(() => check(one(), status), /Production audit/);
    }
    assert.throws(() => check(report(), 1), /inconsistent total or exit code/);
    for (const r of [null, {}, { error: { code: "ENETWORK" } }]) {
        assert.throws(() => check(r, 1), /Production audit/);
    }
    for (const raw of ["", "not JSON"]) {
        assert.throws(
            () => evaluateProductionAudit(raw, 1),
            /Production audit/,
        );
    }
    const wrongTotal = one();
    wrongTotal.metadata.vulnerabilities.total = 0;
    assert.throws(() => check(wrongTotal, 1), /Production audit/);
    const wrongSeverityCount = one();
    wrongSeverityCount.metadata.vulnerabilities.moderate = 0;
    assert.throws(
        () => check(wrongSeverityCount, 1),
        /inconsistent vulnerability counts/,
    );
});

test("the CLI exits nonzero when npm cannot reach the audit registry", () => {
    for (const offline of ["false", "true"]) {
        const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL("./audit-production.mjs", import.meta.url))],
            {
                encoding: "utf8",
                timeout: 20_000,
                env: {
                    ...process.env,
                    npm_config_registry: "http://127.0.0.1:0",
                    npm_config_fetch_retries: "0",
                    npm_config_fetch_timeout: "1000",
                    npm_config_offline: offline,
                },
            },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Production audit failed/);
        // Linux refuses port zero; macOS reports the address as unavailable.
        assert.match(result.stderr, /\b(?:ECONNREFUSED|EADDRNOTAVAIL)\b/);
        assert.match(
            result.stderr,
            /http:\/\/127\.0\.0\.1:0\/-\/npm\/v1\/security\/advisories\/bulk/,
        );
        assert.doesNotMatch(result.stdout, /Production audit exception/);
    }
});

test("the CLI rejects shrinkwrap alongside package-lock before contacting npm", () => {
    const fixture = mkdtempSync(join(tmpdir(), "production-audit-shrinkwrap-"));
    try {
        const root = join(fixture, "workspace");
        mkdirSync(join(root, "scripts"), { recursive: true });
        // macOS temporary paths can alias their canonical location; exercise
        // the same CLI path mismatch on every platform, including Linux.
        const alias = join(fixture, "alias");
        symlinkSync(root, alias, "junction");
        const script = join(root, "scripts", "audit-production.mjs");
        copyFileSync(
            new URL("./audit-production.mjs", import.meta.url),
            script,
        );
        const manifest = { name: "audit-fixture", version: "1.0.0" };
        const fixtureLock = {
            ...manifest,
            lockfileVersion: 3,
            packages: { "": manifest },
        };
        writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
        for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
            writeFileSync(join(root, filename), JSON.stringify(fixtureLock));
        }
        const result = spawnSync(
            process.execPath,
            [join(alias, "scripts", "audit-production.mjs")],
            {
                encoding: "utf8",
                timeout: 20_000,
                env: {
                    ...process.env,
                    npm_config_registry: "http://127.0.0.1:0",
                    npm_config_fetch_retries: "0",
                    npm_config_fetch_timeout: "1000",
                },
            },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /Production audit failed: npm-shrinkwrap\.json overrides package-lock\.json/,
        );
        assert.doesNotMatch(
            result.stderr,
            /\b(?:ECONNREFUSED|EADDRNOTAVAIL)\b/,
        );
        assert.equal(result.stdout, "");
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});
