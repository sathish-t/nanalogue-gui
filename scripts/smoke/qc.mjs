/**
 * Verify: QC mode
 *
 * Checks:
 *  - QC config page loads after clicking the mode button
 *  - generateQC IPC call succeeds with demo BAM
 *  - QC results page renders with all five tabs present
 *  - Four tabs contain a rendered chart canvas; the sequences tab displays text content
 *
 * Usage:  node scripts/smoke/qc.mjs
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

/** Demo BAM committed to the repo. */
const DEMO_BAM = resolve(projectRoot, "demo/demo.bam");

/**
 * Tabs that render a Chart.js canvas, and the one that renders a table.
 * The sequences tab shows a text table for small regions, not a canvas.
 */
const CHART_TABS = ["read-lengths", "yield", "density", "probability"];
const TABLE_TABS = ["sequences"];

await run("QC mode", async () => {
    const { app, page } = await launch();
    const outDir = makeOutDir("qc");
    try {
        // --- navigate to QC config ---
        await goToLanding(page);
        await page.click("#btn-qc");
        await page.waitForURL(/qc-config\.html/, { timeout: 10_000 });
        await page.waitForLoadState("domcontentloaded");
        pass("QC config page loaded");

        await page.screenshot({ path: `${outDir}/01-qc-config.png` });
        console.log(`  📸  ${outDir}/01-qc-config.png`);

        // --- trigger QC generation via IPC ---
        await page.evaluate(
            ({ bamPath }) =>
                window.api.generateQC({
                    bamPath,
                    treatAsUrl: false,
                    tag: "a",
                    modStrand: "bc",
                    region: "contig_00000:1490-1510",
                    sampleFraction: 100,
                    sampleSeed: 42,
                    windowSize: 50,
                    readLengthBinWidth: 100,
                }),
            { bamPath: DEMO_BAM },
        );
        pass("generateQC IPC call dispatched");

        // --- QC results page ---
        await page.waitForURL(/qc-results\.html/, { timeout: 30_000 });
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1000);
        pass("QC results page loaded");

        // --- check chart tabs ---
        // Active tab panels have class "tab-content active". Chart.js sets canvas
        // dimensions only once the panel is visible, so we wait for non-zero size
        // on the canvas inside the active panel.
        for (const tab of CHART_TABS) {
            await page.click(`button.tab-button[data-tab="${tab}"]`);

            await page.waitForFunction(
                () => {
                    const canvas = document.querySelector(
                        ".tab-content.active canvas",
                    );
                    return canvas && canvas.width > 0 && canvas.height > 0;
                },
                null,
                { timeout: 10_000 },
            );
            pass(`tab "${tab}" — chart canvas rendered`);

            await page.screenshot({ path: `${outDir}/02-qc-${tab}.png` });
            console.log(`  📸  ${outDir}/02-qc-${tab}.png`);
        }

        // --- check table tabs ---
        // The sequences tab renders a text table, not a canvas.
        for (const tab of TABLE_TABS) {
            await page.click(`button.tab-button[data-tab="${tab}"]`);

            const activePanel = page.locator(".tab-content.active");
            await activePanel.waitFor({ state: "visible", timeout: 5000 });
            const text = await activePanel.textContent();
            assert(
                text && text.trim().length > 0,
                `sequences tab panel is empty`,
            );
            pass(`tab "${tab}" — content visible`);

            await page.screenshot({ path: `${outDir}/02-qc-${tab}.png` });
            console.log(`  📸  ${outDir}/02-qc-${tab}.png`);
        }
    } finally {
        await app.close();
    }
});
