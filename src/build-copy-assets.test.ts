import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Package metadata needed to execute the renderer asset copy scripts. */
interface PackageScripts {
    /** Maps npm script names to their shell commands. */
    scripts: Record<string, string>;
}

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
) as PackageScripts;

const requiredCopyAssets = {
    "copy:qc": [
        "src/renderer/qc/qc-config.html",
        "src/renderer/qc/qc-results.html",
        "src/renderer/qc/qc.css",
    ],
    "copy:locate": [
        "src/renderer/locate/locate-config.html",
        "src/renderer/locate/locate-config.css",
    ],
    "copy:ai-chat": [
        "src/renderer/ai-chat/ai-chat.html",
        "src/renderer/ai-chat/ai-chat.css",
    ],
};

/**
 * Runs one package copy script inside an isolated fixture project.
 *
 * @param scriptName - The npm copy script to run.
 * @param fixtureRoot - The isolated project directory containing source assets.
 * @returns The completed npm process result.
 */
function runFixtureCopyScript(scriptName: string, fixtureRoot: string) {
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath ? process.execPath : "npm";
    const args = npmExecPath
        ? [npmExecPath, "run", scriptName, "--silent"]
        : ["run", scriptName, "--silent"];
    return spawnSync(command, args, { cwd: fixtureRoot, encoding: "utf8" });
}

describe("required renderer asset copy scripts", () => {
    for (const [scriptName, requiredAssets] of Object.entries(
        requiredCopyAssets,
    )) {
        it(`${scriptName} fails when a required source is unavailable`, () => {
            const fixtureRoot = mkdtempSync(
                join(tmpdir(), "nanalogue-copy-assets-"),
            );

            try {
                for (const asset of requiredAssets) {
                    const fixtureAsset = join(fixtureRoot, asset);
                    mkdirSync(dirname(fixtureAsset), { recursive: true });
                    writeFileSync(fixtureAsset, basename(asset));
                }
                writeFileSync(
                    join(fixtureRoot, "package.json"),
                    JSON.stringify({
                        scripts: {
                            [scriptName]: packageJson.scripts[scriptName],
                        },
                    }),
                );

                const successfulResult = runFixtureCopyScript(
                    scriptName,
                    fixtureRoot,
                );
                expect(successfulResult.error).toBeUndefined();
                expect(successfulResult.status).toBe(0);
                for (const asset of requiredAssets) {
                    const copiedAsset = join(
                        fixtureRoot,
                        "dist",
                        relative("src", asset),
                    );
                    expect(readFileSync(copiedAsset, "utf8")).toBe(
                        basename(asset),
                    );
                }

                for (const asset of requiredAssets) {
                    const fixtureAsset = join(fixtureRoot, asset);
                    const copiedAsset = join(
                        fixtureRoot,
                        "dist",
                        relative("src", asset),
                    );
                    unlinkSync(copiedAsset);
                    unlinkSync(fixtureAsset);
                    try {
                        const result = runFixtureCopyScript(
                            scriptName,
                            fixtureRoot,
                        );
                        expect(result.error).toBeUndefined();
                        expect(result.status).not.toBe(0);
                        expect(result.stderr).toContain(basename(asset));
                        expect(existsSync(copiedAsset)).toBe(false);
                    } finally {
                        writeFileSync(fixtureAsset, basename(asset));
                    }
                }
            } finally {
                rmSync(fixtureRoot, { recursive: true, force: true });
            }
        });
    }
});
