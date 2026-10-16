// Default-limit exhaustion tests run after the unit project to avoid CPU contention.

import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A separate process lets the watchdog fire even if Bash blocks its event loop.
describe("default Bash resource exhaustion", () => {
    let childScript: string;
    let allowedDir: string;

    beforeAll(() => {
        const bundle = buildSync({
            entryPoints: [join(import.meta.dirname, "bash.ts")],
            bundle: true,
            platform: "node",
            format: "cjs",
            packages: "external",
            write: false,
        }).outputFiles[0].text;
        // Deliberately omit options: the production defaults must stop the work,
        // not a reduced test budget or an abort signal from this harness.
        childScript = `${bundle}
const command = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const bash = module.exports.makeBash(process.argv[1]);
bash(command).then(result => process.stdout.write(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exitCode = 1; });
`;
    });

    beforeEach(async () => {
        allowedDir = await realpath(
            await mkdtemp(join(tmpdir(), "bash-resources-")),
        );
    });

    afterEach(async () => {
        await rm(allowedDir, { recursive: true });
    });

    it.each([
        {
            name: "infinite Bash loop",
            command: "while true; do :; done",
            exitCode: 126,
            error: /too many commands executed \(>1000000\)/,
        },
        {
            name: "infinite AWK loop",
            command: "awk 'BEGIN { while(1) n++ }'",
            exitCode: 126,
            error: /maximum iterations \(1000000\)/i,
        },
        {
            name: "oversized array",
            command: "IFS=, read -a values < oversized-array.txt",
            // Empty comma-delimited fields exceed the array cap while the
            // input remains below the default 1 MiB file-read limit.
            input: ",".repeat(1_000_002),
            exitCode: 1,
            error: /array.*1000000/i,
        },
        {
            name: "infinite function recursion",
            command: "recurse() { recurse; }; recurse",
            exitCode: 126,
            error: /maximum recursion depth \(100\)/i,
        },
    ])("halts $name at its resource limit using real defaults", async ({
        command,
        error,
        input,
        exitCode,
    }) => {
        if (input) {
            await writeFile(join(allowedDir, "oversized-array.txt"), input);
        }
        const stdout = await new Promise<string>((resolve, reject) => {
            // Safety net for a missing limit, not a performance requirement.
            // A watchdog kill fails; only the resource-limit error passes.
            const child = execFile(
                process.execPath,
                ["-e", childScript, allowedDir],
                { timeout: 120_000, killSignal: "SIGKILL" },
                (failure, output, stderr) => {
                    if (failure) {
                        const reason = failure.killed
                            ? "120-second watchdog"
                            : failure.code;
                        reject(
                            new Error(
                                `Bash resource probe failed (${reason}): ${stderr}`,
                            ),
                        );
                    } else {
                        resolve(output);
                    }
                },
            );
            child.stdin?.on("error", () => {
                // A watchdog kill can close stdin before input is sent.
                // The execFile callback reports the child's failure instead.
            });
            child.stdin?.end(JSON.stringify(command));
        });
        const result = JSON.parse(stdout) as {
            /** Shell status returned by the resource limit, not the watchdog. */
            exit_code: number;
            /** Diagnostic identifying the resource limit that stopped execution. */
            stderr: string;
        };
        expect(result.exit_code).toBe(exitCode);
        expect(result.stderr).toMatch(error);
    }, 125_000);
});
