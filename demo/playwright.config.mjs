// Playwright config for demo screenshot automation.
// Run with: npx playwright test --config demo/playwright.config.mjs

import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "take-screenshots.mjs",
    timeout: 60_000,
});
