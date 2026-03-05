/**
 * Verify: Landing page
 *
 * Checks:
 *  - All five mode buttons are present and enabled
 *  - Font-size controls are present
 *  - Version dialog opens with version text and closes cleanly
 *
 * Usage:  node scripts/smoke/landing.mjs
 */

import {
    assert,
    goToLanding,
    launch,
    makeOutDir,
    pass,
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
    } finally {
        await app.close();
    }
});
