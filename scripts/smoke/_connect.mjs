/**
 * Shared helpers for all CDP smoke scripts.
 *
 * Launches a fresh Electron instance for each smoke run using Playwright's
 * electron.launch(). This means the scripts are fully autonomous — no
 * manually running app required — and work for both renderer and main process
 * changes (since a fresh build is always loaded from dist/).
 *
 * For interactive debugging sessions (poking around a live app), use
 * scripts/start-debug.sh separately — that is unrelated to these scripts.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

/** Absolute path to the project root (two levels up from scripts/smoke/). */
export const projectRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
);

/** Absolute path to the landing page in dist/. */
export const landingUrl = `file://${projectRoot}/dist/renderer/landing/landing.html?fontSize=medium`;

/**
 * Parses ELECTRON_EXTRA_LAUNCH_ARGS env var into an array of CLI flags.
 * Used in CI to pass --no-sandbox --disable-gpu flags to Electron.
 *
 * @returns {string[]}
 */
function extraElectronArgs() {
    const raw = process.env.ELECTRON_EXTRA_LAUNCH_ARGS ?? "";
    return raw.split(/\s+/).filter(Boolean);
}

/**
 * Launches a fresh Electron app and returns the app handle and first window.
 * The caller is responsible for calling app.close() when done.
 *
 * @returns {{ app: import('playwright').ElectronApplication, page: import('playwright').Page }}
 */
export async function launch() {
    const app = await electron.launch({
        args: [...extraElectronArgs(), resolve(projectRoot, "dist", "main.js")],
        cwd: projectRoot,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

/**
 * Navigates to the landing page regardless of where the app currently is.
 * Waits for the DOM to be ready before returning.
 *
 * @param {import('playwright').Page} page
 */
export async function goToLanding(page) {
    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
}

/**
 * Creates a timestamped output directory under the OS temp dir for screenshots and
 * returns its path.
 *
 * @param {string} label  Short label, e.g. "swipe" or "landing".
 * @returns {string}
 */
export function makeOutDir(label) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = resolve(tmpdir(), `smoke-${label}-${ts}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Assertion helper. Throws with a descriptive message on failure.
 *
 * @param {boolean} condition
 * @param {string}  message
 */
export function assert(condition, message) {
    if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/**
 * Logs a labelled PASS line to stdout.
 *
 * @param {string} label
 */
export function pass(label) {
    console.log(`  ✓  ${label}`);
}

/**
 * Runs a verify script's main function, printing a tidy header/footer and
 * handling top-level errors uniformly.
 *
 * @param {string}            name  Display name for the script.
 * @param {() => Promise<void>} fn  The script body.
 */
export async function run(name, fn) {
    console.log(`\n── ${name} ──`);
    try {
        await fn();
        console.log(`\nRESULT: PASS\n`);
    } catch (err) {
        console.error(`\nRESULT: FAIL — ${err.message}\n`);
        process.exitCode = 1;
    }
}
