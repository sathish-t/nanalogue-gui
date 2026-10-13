// Exercises the real Electron utility watchdog with responsive parents and
// parents that block after sending the arm request, not before shutdown begins.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electronPath from "electron";
import { projectRoot } from "./_connect.mjs";

const directory = await mkdtemp(join(tmpdir(), "exit-watchdog-smoke-"));
const entryPath = join(directory, "main.cjs");
const watchdogPath = resolve(projectRoot, "dist/exit-watchdog.js");

try {
    await writeFile(
        entryPath,
        `const { app, utilityProcess } = require('electron');
app.whenReady().then(() => {
    const watchdog = utilityProcess.fork(${JSON.stringify(watchdogPath)}, [String(process.pid)]);
    watchdog.on('message', message => {
        if (message === 'exit-watchdog-armed') watchdog.postMessage('kill-parent');
    });
    watchdog.once('spawn', () => {
        watchdog.postMessage('arm-exit-watchdog');
        if (process.argv.includes('blocked')) {
            // Block only after sending the arm request. No callback or timer can run now.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
    });
});
`,
    );

    for (const mode of ["responsive", "blocked"]) {
        const child = spawn(
            electronPath,
            [
                ...(process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "")
                    .split(/\s+/)
                    .filter(Boolean),
                entryPath,
                mode,
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        let diagnostics = "";
        child.stderr.on("data", (chunk) => {
            diagnostics += chunk;
        });
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, 6000);
        try {
            const result = await new Promise((resolveExit, reject) => {
                child.once("error", reject);
                child.once("exit", (code, signal) => {
                    resolveExit({ code, signal });
                });
            });
            assert.equal(
                timedOut,
                false,
                `${mode} parent hung: ${diagnostics}`,
            );
            assert.equal(result.signal, "SIGKILL", JSON.stringify(result));
            console.log(
                `PASS: watchdog kills ${mode} parent without main fallback`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}
