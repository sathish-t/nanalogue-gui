/**
 * Verify: Swipe mode
 *
 * Checks:
 *  - Swipe config page loads after clicking the mode button
 *  - swipeStart IPC call succeeds with demo files
 *  - Swipe review page renders a chart (canvas present)
 *  - Annotation counter shows expected format (N / Total)
 *  - Accepting an annotation advances the counter
 *
 * Usage:  node scripts/smoke/swipe.mjs
 */

import { tmpdir } from "node:os";
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

/** Demo files committed to the repo. */
const DEMO_BAM = resolve(projectRoot, "demo/swipe.bam");
const DEMO_BED = resolve(projectRoot, "demo/swipe.bed");
const OUTPUT_BED = resolve(tmpdir(), "smoke-swipe-output.bed");

await run("Swipe mode", async () => {
    const { app, page } = await launch();
    const outDir = makeOutDir("swipe");
    try {
        // --- navigate to swipe config ---
        await goToLanding(page);
        await page.click("#btn-swipe");
        await page.waitForURL(/swipe-config\.html/, { timeout: 10_000 });
        await page.waitForLoadState("domcontentloaded");
        pass("swipe config page loaded");

        await page.screenshot({ path: `${outDir}/01-swipe-config.png` });
        console.log(`  📸  ${outDir}/01-swipe-config.png`);

        // --- start swipe session via IPC ---
        const result = await page.evaluate(
            ({ bam, bed, out }) =>
                window.api.swipeStart(
                    bam,
                    bed,
                    out,
                    /* windowSize        */ 300,
                    /* modTag            */ "T",
                    /* modStrand         */ "bc",
                    /* flankingRegion    */ 1000,
                    /* showAnnotHighlight*/ true,
                    /* treatAsUrl        */ false,
                ),
            { bam: DEMO_BAM, bed: DEMO_BED, out: OUTPUT_BED },
        );
        assert(
            result.success,
            `swipeStart failed: ${result.reason ?? "unknown"}`,
        );
        pass("swipeStart IPC call succeeded");

        // --- swipe review page ---
        await page.waitForURL(/swipe\.html/, { timeout: 15_000 });
        await page.waitForLoadState("domcontentloaded");

        // Wait for the chart canvas to appear
        const canvas = page.locator("canvas").first();
        await canvas.waitFor({ state: "visible", timeout: 10_000 });
        pass("chart canvas rendered");

        // Check the annotation counter (format: "N / Total")
        const counter = page.locator("#progress-text");
        await counter.waitFor({ state: "visible", timeout: 5000 });
        const counterText = (await counter.textContent()) ?? "";
        assert(
            /\d+\s*\/\s*\d+/.test(counterText),
            `counter not found in: ${counterText.slice(0, 200)}`,
        );
        pass(
            `annotation counter visible — "${counterText.match(/\d+\s*\/\s*\d+/)?.[0]}"`,
        );

        await page.screenshot({ path: `${outDir}/02-swipe-first.png` });
        console.log(`  📸  ${outDir}/02-swipe-first.png`);

        // --- accept an annotation and verify counter advances ---
        const counterBefore = counterText.match(/(\d+)\s*\/\s*(\d+)/);
        const nBefore = counterBefore ? parseInt(counterBefore[1], 10) : -1;

        await page.click(".control-hint.right");

        // Wait for the counter to update rather than a blind sleep
        await page.waitForFunction(
            ({ sel, before }) =>
                document.querySelector(sel)?.textContent !== before,
            { sel: "#progress-text", before: counterText },
            { timeout: 10_000 },
        );

        const counterAfterText = (await counter.textContent()) ?? "";
        const counterAfter = counterAfterText.match(/(\d+)\s*\/\s*(\d+)/);
        const nAfter = counterAfter ? parseInt(counterAfter[1], 10) : -1;
        assert(
            nAfter > nBefore,
            `counter did not advance (before=${nBefore}, after=${nAfter})`,
        );
        pass(`counter advanced from ${nBefore} → ${nAfter}`);

        await page.screenshot({ path: `${outDir}/03-swipe-after-accept.png` });
        console.log(`  📸  ${outDir}/03-swipe-after-accept.png`);
    } finally {
        await app.close();
    }
});
