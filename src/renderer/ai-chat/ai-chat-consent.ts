// Consent dialog helpers for the AI Chat renderer.

import { getAiChatElements } from "./ai-chat-elements";

const { btnConsentAccept, btnConsentCancel, consentDialog, consentOrigin } =
    getAiChatElements();

/** Pending consent resolver (for the consent dialog flow). */
let pendingConsentResolve: ((accepted: boolean) => void) | null = null;

/**
 * Atomically captures and clears the consent resolver to prevent double invocation
 * from both the button click and the dialog close event.
 *
 * @param accepted - Whether the user accepted the consent prompt.
 */
function resolveConsent(accepted: boolean): void {
    const resolver = pendingConsentResolve;
    if (!resolver) return;
    pendingConsentResolve = null;
    resolver(accepted);
}

/**
 * Wires the consent dialog buttons and close handler.
 */
export function initConsentDialog(): void {
    btnConsentAccept?.addEventListener("click", () => {
        consentDialog.close();
        resolveConsent(true);
    });

    btnConsentCancel?.addEventListener("click", () => {
        consentDialog.close();
        resolveConsent(false);
    });

    consentDialog.addEventListener("close", () => {
        resolveConsent(false);
    });
}

/**
 * Displays the consent dialog for an endpoint origin.
 *
 * @param origin - The endpoint origin that requires consent.
 * @returns Whether the user accepted the prompt.
 */
export async function requestConsent(origin: string): Promise<boolean> {
    consentOrigin.textContent = origin;
    return await new Promise<boolean>((resolve) => {
        pendingConsentResolve = resolve;
        consentDialog.showModal();
    });
}
