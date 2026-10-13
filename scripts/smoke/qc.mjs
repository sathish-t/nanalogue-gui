/**
 * Verify: QC mode
 *
 * Checks:
 *  - QC config page loads after clicking the mode button
 *  - Read-ID selection/counting works before and after opening Locate
 *  - generateQC IPC call succeeds with demo BAM
 *  - QC results page renders with all five tabs present
 *  - Four tabs contain a rendered chart canvas; every sequence row renders on first opening
 *
 * Usage:  node scripts/smoke/qc.mjs
 */

import { deepStrictEqual } from "node:assert";
import { writeFileSync } from "node:fs";
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

        // Only the OS dialog is stubbed; clicks, IPC registration, path validation,
        // file reading, counting, and renderer updates run against the built app.
        const readIdPath = resolve(outDir, "read-ids.txt");
        writeFileSync(readIdPath, "read-a\n\nread-b\n");
        for (const mode of ["qc", "locate"]) {
            if (mode === "qc") {
                await page.click("#advanced-options summary");
            }
            await app.evaluate(({ dialog }, path) => {
                const original = dialog.showOpenDialog;
                dialog.showOpenDialog = async () => {
                    dialog.showOpenDialog = original;
                    return { canceled: false, filePaths: [path] };
                };
            }, readIdPath);
            await page.click("#btn-browse-read-ids");
            await page.waitForFunction(
                ({ path, mode }) =>
                    document.querySelector("#read-id-path").value === path &&
                    (mode === "qc"
                        ? document.querySelector("#read-id-count")
                              .textContent === "2 read IDs found"
                        : document
                              .querySelector("#file-summary")
                              .textContent.includes("2 read IDs")),
                { path: readIdPath, mode },
                { timeout: 5000 },
            );
            pass(`${mode} read-ID picker and counter work`);
            await page.click("#btn-back");
            await page.waitForURL(/landing\.html/);
            await page.click(mode === "qc" ? "#btn-locate" : "#btn-qc");
            await page.waitForURL(
                mode === "qc" ? /locate-config\.html/ : /qc-config\.html/,
            );
        }
        await app.evaluate(({ dialog }) => {
            const original = dialog.showOpenDialog;
            dialog.showOpenDialog = async () => {
                dialog.showOpenDialog = original;
                return { canceled: true, filePaths: [] };
            };
        });
        assert(
            (await page.evaluate(() => window.api.locatePickReadIds())) ===
                null,
            "cancelled picker returns null",
        );
        const invalidPathError = await page.evaluate(async () => {
            try {
                await window.api.locateCountReadIds("");
                return "";
            } catch (error) {
                return error.message;
            }
        });
        assert(
            invalidPathError.includes("Invalid Locate read ID path"),
            "read-ID counter rejects invalid paths",
        );

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
        await page.waitForFunction(
            () =>
                document.querySelector("#stats-read-lengths").children.length >
                0,
        );
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
        // Compare the rendered rows with the IPC payload, not static panel text.
        // This fixture spans multiple rendering batches, so a stalled batch fails.
        const expectedRows = await page.evaluate(async () => {
            const data = await window.api.getQCData();
            return data.seqTableRows?.map((row) => [
                row.readId,
                row.baseSequence,
            ]);
        });
        assert(
            expectedRows?.length > 10,
            "demo region must provide multiple batches of sequence rows",
        );
        assert(
            (await page.locator("#seq-table-container tbody tr").count()) === 0,
            "sequence rows should be deferred until their tab opens",
        );
        for (const tab of TABLE_TABS) {
            await page.click(`button.tab-button[data-tab="${tab}"]`);

            const activePanel = page.locator("#tab-sequences.active");
            await activePanel.waitFor({ state: "visible", timeout: 5000 });
            await page.waitForFunction(
                (count) =>
                    document.querySelectorAll("#seq-table-container tbody tr")
                        .length === count,
                expectedRows.length,
                { timeout: 10_000 },
            );
            const actualRows = await activePanel
                .locator("tbody tr")
                .evaluateAll((rows) =>
                    rows.map((row) => [
                        row.querySelector(".seq-read-id").textContent,
                        row.querySelector("td:nth-child(3)").textContent,
                    ]),
                );
            deepStrictEqual(
                actualRows,
                expectedRows,
                "sequence read IDs and bases must match the QC data",
            );
            pass(
                `tab "${tab}" — all ${actualRows.length} sequence rows rendered with matching read IDs and bases`,
            );

            await page.screenshot({ path: `${outDir}/02-qc-${tab}.png` });
            console.log(`  📸  ${outDir}/02-qc-${tab}.png`);
        }
    } finally {
        await app.close();
    }
});
