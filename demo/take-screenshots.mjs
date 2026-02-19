// Launches the Electron app with Playwright and takes screenshots.
// Run with: npx playwright test --config demo/playwright.config.mjs

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { _electron as electron } from "playwright";

const dir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(dir, "..");
const demoBam = resolve(dir, "demo.bam");
const swipeBam = resolve(dir, "swipe.bam");
const swipeBed = resolve(dir, "swipe.bed");
const swipeOutput = resolve(dir, "swipe-output.bed");

/**
 * Launches the Electron app and returns the app and first window.
 */
async function launchApp() {
    const app = await electron.launch({
        args: [resolve(projectRoot, "dist", "main.js")],
        cwd: projectRoot,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

test("QC mode screenshots", async () => {
    const { app, page } = await launchApp();

    // Screenshot the landing page
    await page.screenshot({ path: resolve(dir, "screenshot-landing.png") });

    // Navigate to QC mode and wait for the new page to load
    await page.click("button#btn-qc");
    await page.waitForURL(/qc-config\.html/);
    await page.waitForLoadState("domcontentloaded");
    await page.screenshot({ path: resolve(dir, "screenshot-qc-config.png") });

    // Set the BAM path directly on the custom element and trigger peek
    await page.evaluate((bamPath) => {
        const bamSource = document.getElementById("bam-source");
        const input = bamSource.shadowRoot
            ? bamSource.shadowRoot.querySelector("input[type='text']")
            : bamSource.querySelector("input[type='text']");
        if (input) {
            input.value = bamPath;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        bamSource.dispatchEvent(
            new CustomEvent("bam-selected", {
                detail: { value: bamPath, isUrl: false },
                bubbles: true,
            }),
        );
    }, demoBam);

    // Wait for peek info to load
    await page.waitForTimeout(2000);
    await page.screenshot({
        path: resolve(dir, "screenshot-qc-config-loaded.png"),
    });

    // Generate QC via IPC, bypassing form validation
    await page.evaluate((bamPath) => {
        return window.api.generateQC({
            bamPath,
            treatAsUrl: false,
            tag: "a",
            modStrand: "bc",
            region: "contig_00000:1490-1510",
            sampleFraction: 100,
            sampleSeed: 42,
            windowSize: 50,
            readLengthBinWidth: 100,
        });
    }, demoBam);

    // Now on qc-results page — wait for actual navigation
    await page.waitForURL(/qc-results\.html/);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Screenshot each QC results tab
    const tabs = [
        "read-lengths",
        "yield",
        "density",
        "probability",
        "sequences",
    ];

    for (const tab of tabs) {
        await page.click(`button.tab-button[data-tab="${tab}"]`);
        await page.waitForTimeout(500);
        await page.screenshot({
            path: resolve(dir, `screenshot-qc-${tab}.png`),
        });
    }

    await app.close();
});

test("Swipe mode screenshots", async () => {
    const { app, page } = await launchApp();

    // Navigate to Swipe mode and wait for the new page to load
    await page.click("button#btn-swipe");
    await page.waitForURL(/swipe-config\.html/);
    await page.waitForLoadState("domcontentloaded");
    await page.screenshot({
        path: resolve(dir, "screenshot-swipe-config.png"),
    });

    // Start swipe session via IPC, bypassing file dialogs
    await page.evaluate(
        ({ bamPath, bedPath, outputPath }) => {
            return window.api.swipeStart(
                bamPath,
                bedPath,
                outputPath,
                50,
                "T",
                "bc",
                100,
                false,
            );
        },
        { bamPath: swipeBam, bedPath: swipeBed, outputPath: swipeOutput },
    );

    // Now on swipe.html — wait for actual navigation and plot render
    await page.waitForURL(/swipe\.html/);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await page.screenshot({
        path: resolve(dir, "screenshot-swipe-review.png"),
    });

    // Accept current annotation by clicking the ACCEPT button
    await page.click(".control-hint.right");
    await page.waitForTimeout(2000);
    await page.screenshot({
        path: resolve(dir, "screenshot-swipe-review-2.png"),
    });

    await app.close();
});
