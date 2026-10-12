// Production audit policy: a single temporary exception must not hide other risks.
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

const lock = {
    packages: {
        "node_modules/just-bash": {
            version: "2.14.2",
            dependencies: { "sprintf-js": "^1.1.3" },
        },
        "node_modules/sprintf-js": { version: "1.1.3" },
    },
};

function approvedReport() {
    return {
        auditReportVersion: 2,
        vulnerabilities: {
            "just-bash": {
                name: "just-bash",
                severity: "moderate",
                isDirect: true,
                range: "*",
                via: ["sprintf-js"],
                nodes: ["node_modules/just-bash"],
                effects: [],
                fixAvailable: false,
            },
            "sprintf-js": {
                name: "sprintf-js",
                severity: "moderate",
                isDirect: false,
                range: "*",
                via: [
                    {
                        name: "sprintf-js",
                        dependency: "sprintf-js",
                        severity: "moderate",
                        range: "<=1.1.3",
                        url: "https://github.com/advisories/GHSA-hp3w-g68c-fv3c",
                    },
                ],
                nodes: ["node_modules/sprintf-js"],
                effects: ["just-bash"],
                fixAvailable: false,
            },
        },
        metadata: {
            vulnerabilities: {
                info: 0,
                low: 0,
                moderate: 2,
                high: 0,
                critical: 0,
                total: 2,
            },
        },
    };
}

const beforeExpiry = new Date("2026-11-10T23:59:59.999Z");
const expiry = new Date("2026-11-11T00:00:00.000Z");
const check = (report, status = 1, date = beforeExpiry, locked = lock) =>
    evaluateProductionAudit(JSON.stringify(report), status, locked, date);

test("accepts only the approved chain before its UTC expiry and reports the risk", () => {
    assert.match(check(approvedReport()), /GHSA-hp3w-g68c-fv3c.*2026-11-11/);
    assert.throws(() => check(approvedReport(), 1, expiry), /expired/);
});

test("a clean production audit passes even after the exception expires", () => {
    const report = approvedReport();
    report.vulnerabilities = {};
    for (const key of Object.keys(report.metadata.vulnerabilities)) {
        report.metadata.vulnerabilities[key] = 0;
    }
    assert.match(check(report, 0, expiry), /no vulnerabilities/);
});

test("rejects unrelated findings, extra advisories, paths, versions and available fixes", () => {
    const mutations = [
        (r) => {
            r.vulnerabilities.other = r.vulnerabilities["just-bash"];
            r.metadata.vulnerabilities.moderate = 3;
            r.metadata.vulnerabilities.total = 3;
        },
        (r) => {
            r.vulnerabilities["sprintf-js"].via[0].url += "-different";
        },
        (r) => {
            r.vulnerabilities["sprintf-js"].via.push({
                url: "another advisory",
            });
        },
        (r) => {
            r.vulnerabilities["just-bash"].via.push("another-package");
        },
        (r) => {
            r.vulnerabilities["sprintf-js"].nodes.push(
                "node_modules/other/node_modules/sprintf-js",
            );
        },
        (r) => {
            r.vulnerabilities["just-bash"].effects.push("another-package");
        },
        (r) => {
            r.vulnerabilities["sprintf-js"].severity = "high";
            r.metadata.vulnerabilities.moderate = 1;
            r.metadata.vulnerabilities.high = 1;
        },
        (r) => {
            r.vulnerabilities["sprintf-js"].fixAvailable = { version: "1.1.4" };
        },
    ];
    for (const mutate of mutations) {
        const report = approvedReport();
        mutate(report);
        assert.throws(() => check(report), /Production audit/);
    }
    for (const name of ["sprintf-js", "just-bash"]) {
        const changedLock = structuredClone(lock);
        changedLock.packages[`node_modules/${name}`].version = "9.9.9";
        assert.throws(
            () => check(approvedReport(), 1, beforeExpiry, changedLock),
            /Production audit/,
        );
    }
    const changedChain = structuredClone(lock);
    changedChain.packages["node_modules/just-bash"].dependencies["sprintf-js"] =
        "*";
    assert.throws(
        () => check(approvedReport(), 1, beforeExpiry, changedChain),
        /dependency chain changed/,
    );
});

test("fails closed on audit errors, malformed reports and inconsistent exit codes/counts", () => {
    for (const status of [null, 2, 0]) {
        assert.throws(
            () => check(approvedReport(), status),
            /Production audit/,
        );
    }
    for (const report of [null, {}, { error: { code: "ENETWORK" } }]) {
        assert.throws(() => check(report), /Production audit/);
    }
    for (const raw of ["", "not JSON"]) {
        assert.throws(
            () => evaluateProductionAudit(raw, 1, lock, beforeExpiry),
            /Production audit/,
        );
    }
    const report = approvedReport();
    report.metadata.vulnerabilities.total = 0;
    assert.throws(() => check(report), /Production audit/);
    report.metadata.vulnerabilities.total = 2;
    delete report.vulnerabilities["sprintf-js"].via;
    assert.throws(() => check(report), /Production audit/);
});

test("requires inherited-only exposure and the reviewed vulnerable release inventory", () => {
    for (const name of ["just-bash", "sprintf-js"]) {
        for (const range of ["<=1.1.3", "", undefined]) {
            const report = approvedReport();
            report.vulnerabilities[name].range = range;
            assert.throws(() => check(report), /Production audit/);
        }
        for (const isDirect of [name !== "just-bash", undefined]) {
            const report = approvedReport();
            report.vulnerabilities[name].isDirect = isDirect;
            assert.throws(() => check(report), /Production audit/);
        }
    }
    const report = approvedReport();
    report.vulnerabilities["sprintf-js"].via[0].range = "<=2.0.0";
    assert.throws(() => check(report), /Production audit/);
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
