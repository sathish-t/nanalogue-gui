// Tests for extracted AI Chat consent helpers.

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loads the ai-chat.html template into the jsdom document.
 */
function loadHtml(): void {
    const htmlPath = join(import.meta.dirname, "ai-chat.html");
    const html = readFileSync(htmlPath, "utf-8");
    document.documentElement.innerHTML = html;
}

describe("ai-chat-consent", () => {
    beforeEach(() => {
        vi.resetModules();
        loadHtml();

        const dialog = document.getElementById(
            "consent-dialog",
        ) as HTMLDialogElement;
        dialog.showModal = vi.fn();
        dialog.close = vi.fn(() => {
            setTimeout(() => {
                dialog.dispatchEvent(new Event("close"));
            }, 0);
        });
    });

    it("resolves true when the user accepts consent", async () => {
        const { initConsentDialog, requestConsent } = await import(
            "./ai-chat-consent"
        );
        const dialog = document.getElementById(
            "consent-dialog",
        ) as HTMLDialogElement;
        const consentOrigin = document.getElementById("consent-origin");
        const btnAccept = document.getElementById(
            "btn-consent-accept",
        ) as HTMLButtonElement;

        initConsentDialog();
        const promise = requestConsent("https://example.com");
        expect(consentOrigin?.textContent).toBe("https://example.com");
        expect(dialog.showModal).toHaveBeenCalledTimes(1);

        btnAccept.click();

        await expect(promise).resolves.toBe(true);
    });

    it("resolves false when the user cancels consent", async () => {
        const { initConsentDialog, requestConsent } = await import(
            "./ai-chat-consent"
        );
        const btnCancel = document.getElementById(
            "btn-consent-cancel",
        ) as HTMLButtonElement;

        initConsentDialog();
        const promise = requestConsent("https://example.com");

        btnCancel.click();

        await expect(promise).resolves.toBe(false);
    });

    it("resolves false when the dialog is dismissed", async () => {
        const { initConsentDialog, requestConsent } = await import(
            "./ai-chat-consent"
        );
        const dialog = document.getElementById(
            "consent-dialog",
        ) as HTMLDialogElement;

        initConsentDialog();
        const promise = requestConsent("https://example.com");

        dialog.dispatchEvent(new Event("close"));

        await expect(promise).resolves.toBe(false);
    });
});
