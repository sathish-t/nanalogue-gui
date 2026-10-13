/**
 * Verify: Landing page
 *
 * Checks:
 *  - All five mode buttons are present and enabled
 *  - Font-size controls are present
 *  - Version dialog opens with version text and closes cleanly
 *  - The newest of two concurrent mode launches controls navigation
 *
 * Usage:  node scripts/smoke/landing.mjs
 */

import { resolve } from "node:path";
import {
    assert,
    goToLanding,
    launch,
    makeOutDir,
    pass,
    projectRoot,
    run,
} from "./_connect.mjs";

await run("Landing page", async () => {
    const { app, page } = await launch();
    const outDir = makeOutDir("landing");
    try {
        await goToLanding(page);

        // --- mode buttons ---
        const modeButtons = [
            "btn-swipe",
            "btn-qc",
            "btn-locate",
            "btn-ai-chat",
            "btn-version",
        ];
        for (const id of modeButtons) {
            const btn = page.locator(`#${id}`);
            await btn.waitFor({ state: "visible", timeout: 5000 });
            const disabled = await btn.getAttribute("disabled");
            assert(disabled === null, `#${id} should not be disabled`);
            pass(`mode button #${id} visible and enabled`);
        }

        // --- font-size controls ---
        for (const id of [
            "btn-font-small",
            "btn-font-medium",
            "btn-font-large",
        ]) {
            const btn = page.locator(`#${id}`);
            await btn.waitFor({ state: "visible", timeout: 3000 });
            pass(`font-size button #${id} visible`);
        }

        // --- version dialog ---
        await page.screenshot({ path: `${outDir}/01-landing.png` });
        console.log(`  📸  ${outDir}/01-landing.png`);

        await page.click("#btn-version");
        const dialog = page.locator("#version-dialog");
        await dialog.waitFor({ state: "visible", timeout: 3000 });

        const versionText = await page.locator("#version-text").textContent();
        assert(
            versionText && versionText.length > 0,
            "version-text should not be empty",
        );
        pass(`version dialog opened — "${versionText?.trim()}"`);

        await page.screenshot({ path: `${outDir}/02-version-dialog.png` });
        console.log(`  📸  ${outDir}/02-version-dialog.png`);

        await page.click("#version-dialog-close");
        await dialog.waitFor({ state: "hidden", timeout: 3000 });
        pass("version dialog closed");

        // --- concurrent mode launch ordering ---
        // Warm QC first so its second launch completes before AI Chat's first
        // large import. The newer QC request must still be the final page.
        await page.click("#btn-qc");
        await page.waitForURL(/qc-config\.html/, { timeout: 15_000 });
        await page.click("#btn-back");
        await page.waitForURL(/landing\.html/, { timeout: 5000 });
        // Invoke from a separate renderer so navigation cannot destroy the
        // promises before both IPC handlers finish, including the stale one.
        const finalUrl = await app.evaluate(
            async ({ BrowserWindow }, preload) => {
                const mainWindow = BrowserWindow.getAllWindows()[0];
                const caller = new BrowserWindow({
                    show: false,
                    webPreferences: {
                        preload,
                        contextIsolation: true,
                        nodeIntegration: false,
                    },
                });
                try {
                    await caller.loadURL("about:blank");
                    await caller.webContents.executeJavaScript(
                        "Promise.all([window.api.launchAiChat(), window.api.launchQC()])",
                    );
                    // Launch replies can precede loadFile completion. Observe the
                    // last navigation finishing instead of sleeping for a deadline.
                    if (mainWindow.webContents.isLoading()) {
                        await new Promise((resolve) =>
                            mainWindow.webContents.once(
                                "did-stop-loading",
                                resolve,
                            ),
                        );
                    }
                    return mainWindow.webContents.getURL();
                } finally {
                    caller.destroy();
                }
            },
            resolve(projectRoot, "dist/preload.js"),
        );
        assert(
            /qc-config\.html/.test(finalUrl),
            "a stale AI Chat launch replaced the newer QC navigation",
        );
        await page
            .locator("#advanced-options")
            .waitFor({ state: "visible", timeout: 5000 });
        pass("newest concurrent mode launch controls navigation");
    } finally {
        await app.close();
    }
});
