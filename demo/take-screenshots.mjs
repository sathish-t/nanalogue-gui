// Launches the Electron app with Playwright and takes screenshots.
// Run with: npx playwright test --config demo/playwright.config.mjs

import { readFileSync } from "node:fs";
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
const questionsFile = resolve(dir, "questions_for_ai.txt");

/**
 * Parses ELECTRON_EXTRA_LAUNCH_ARGS env var into an array of CLI flags.
 * @returns {string[]} Array of extra Electron flags, empty if env var is unset.
 */
function extraElectronArgs() {
    const raw = process.env.ELECTRON_EXTRA_LAUNCH_ARGS || "";
    return raw.split(/\s+/).filter(Boolean);
}

/**
 * Launches the Electron app and returns the app and first window.
 */
async function launchApp() {
    const app = await electron.launch({
        args: [...extraElectronArgs(), resolve(projectRoot, "dist", "main.js")],
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

test("AI Chat mode screenshots", async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.log("OPENAI_API_KEY not set — skipping AI Chat screenshots");
        return;
    }

    const { app, page } = await launchApp();

    // Navigate to AI Chat mode
    await page.click("button#btn-ai-chat");
    await page.waitForURL(/ai-chat\.html/);
    await page.waitForLoadState("domcontentloaded");
    await page.screenshot({
        path: resolve(dir, "screenshot-ai-chat-config.png"),
    });

    // Fill in the endpoint URL
    await page.fill("#input-endpoint", "https://api.openai.com/v1");
    await page.waitForTimeout(5000);

    // Fill in the API key
    await page.fill("#input-api-key", apiKey);
    await page.waitForTimeout(5000);

    // Fill in the model name
    await page.fill("#input-model", "gpt-5.2-chat-latest");
    await page.waitForTimeout(5000);

    // Set the BAM directory to the demo folder
    await page.evaluate((demoDir) => {
        const input = document.getElementById("input-dir");
        input.value = demoDir;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }, dir);
    await page.waitForTimeout(2000);

    await page.screenshot({
        path: resolve(dir, "screenshot-ai-chat-configured.png"),
    });

    // Read questions from the questions file (one per line)
    const questions = readFileSync(questionsFile, "utf-8")
        .split("\n")
        .map((q) => q.trim())
        .filter(Boolean);

    // Grant consent for the remote OpenAI endpoint on the first send.
    // The consent dialog appears when sending to a non-localhost endpoint.
    let consentHandled = false;

    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        // Type the question and click Send
        await page.fill("#input-message", question);
        await page.click("#btn-send");

        // Handle the consent dialog on first send
        if (!consentHandled) {
            try {
                await page.waitForSelector("#consent-dialog[open]", {
                    timeout: 5000,
                });
                await page.click("#btn-consent-accept");
                consentHandled = true;
                // After consent, the app retries the request asynchronously.
                // Wait for the retry to enter processing state before checking
                // for completion, otherwise btn-send is briefly visible.
                await page.waitForFunction(
                    () => document.getElementById("btn-send")?.classList.contains("hidden"),
                    { timeout: 10_000 },
                );
            } catch {
                // Consent dialog may not appear (e.g. already consented)
                consentHandled = true;
            }
        }

        // Wait for the send button to reappear (hidden during processing).
        // The btn-send element gets the "hidden" class while a request is in flight.
        await page.waitForFunction(
            () => !document.getElementById("btn-send")?.classList.contains("hidden"),
            { timeout: 120_000 },
        );

        // Allow extra time for the UI to render the response
        await page.waitForTimeout(10_000);

        // Maximize the window before the last question's screenshot
        if (i === questions.length - 1) {
            await app.evaluate(({ BrowserWindow }) => {
                const win = BrowserWindow.getAllWindows()[0];
                if (win) win.maximize();
            });
            await page.waitForTimeout(1000);
        }

        // Scroll the chat area to make the latest response visible.
        // The scrollable container is #chat-area, not the inner #chat-messages div.
        await page.evaluate(() => {
            const chatArea = document.getElementById("chat-area");
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        });
        await page.waitForTimeout(1000);

        await page.screenshot({
            path: resolve(dir, `screenshot-ai-chat-q${i + 1}.png`),
        });
    }

    // Expand the Sandboxed Code panel and screenshot it
    await page.click("#code-panel-toggle");
    await page.waitForTimeout(1000);

    // Scroll so the code panel is fully visible
    await page.evaluate(() => {
        const codePanel = document.getElementById("code-panel-content");
        if (codePanel) codePanel.scrollIntoView({ block: "end" });
    });
    await page.waitForTimeout(1000);

    await page.screenshot({
        path: resolve(dir, "screenshot-ai-chat-q3-sandbox.png"),
    });

    await app.close();
});
