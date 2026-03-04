import { applyFontSize } from "../shared/apply-font-size";

// Apply font size from URL query param (set when navigating back from another mode).
applyFontSize();

/**
 * Result returned by mode launch IPC handlers.
 */
interface LaunchResult {
    /** Whether the launch succeeded. */
    success: boolean;
    /** The reason for failure when success is false. */
    reason?: string;
}

/**
 * Defines the preload API exposed to the landing page renderer for launching application modes.
 */
interface LandingApi {
    /** Returns the application version string from package.json. */
    getVersion: () => Promise<string>;
    /** Opens a URL in the user's default OS browser. */
    openExternalUrl: (url: string) => Promise<void>;
    /** Launches the swipe mode for interactive read annotation review. */
    launchSwipe: () => Promise<LaunchResult>;
    /** Launches the QC mode for generating quality control reports. */
    launchQC: () => Promise<LaunchResult>;
    /** Launches the locate reads mode for converting read IDs to BED format. */
    launchLocate: () => Promise<LaunchResult>;
    /** Launches the AI Chat mode for LLM-powered BAM analysis. */
    launchAiChat: () => Promise<LaunchResult>;
    /** Updates the font-size preference in the main process. */
    setFontSize: (size: string) => Promise<void>;
}

/** The preload API instance retrieved from the window object for invoking main process actions. */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: LandingApi;
    }
).api;

// --- Font size controls ---

const fontSizeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".font-size-btn"),
);

/**
 * Updates the active state of the font size buttons to match the given size.
 *
 * @param size - The font size that should appear active ('small', 'medium', or 'large').
 */
function setActiveFontBtn(size: string): void {
    for (const btn of fontSizeBtns) {
        const isActive = btn.dataset.size === size;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
    }
}

// Initialise active state from the URL param (medium when no param is present).
const initialSize =
    new URLSearchParams(window.location.search).get("fontSize") ?? "medium";
setActiveFontBtn(initialSize);

for (const btn of fontSizeBtns) {
    btn.addEventListener("click", async () => {
        const size = btn.dataset.size ?? "medium";
        // Apply class to <html> immediately so the change is instant.
        const html = document.documentElement;
        html.classList.remove("font-small", "font-medium", "font-large");
        html.classList.add(`font-${size}`);
        setActiveFontBtn(size);
        try {
            await api.setFontSize(size);
        } catch (error) {
            console.error("Failed to set font size:", error);
        }
    });
}

// --- Mode buttons ---

const btnSwipe = document.getElementById("btn-swipe") as HTMLButtonElement;
const btnQC = document.getElementById("btn-qc") as HTMLButtonElement;
const btnLocate = document.getElementById("btn-locate") as HTMLButtonElement;
const btnAiChat = document.getElementById("btn-ai-chat") as HTMLButtonElement;
const btnVersion = document.getElementById("btn-version") as HTMLButtonElement;

btnSwipe.addEventListener("click", async () => {
    try {
        const result = await api.launchSwipe();
        if (!result.success) {
            alert(
                `Failed to launch swipe mode: ${result.reason ?? "Unknown error"}`,
            );
        }
    } catch (error) {
        alert(`Failed to launch swipe mode: ${String(error)}`);
    }
});

btnQC.addEventListener("click", async () => {
    try {
        const result = await api.launchQC();
        if (!result.success) {
            alert(
                `Failed to launch QC mode: ${result.reason ?? "Unknown error"}`,
            );
        }
    } catch (error) {
        alert(`Failed to launch QC mode: ${String(error)}`);
    }
});

btnLocate.addEventListener("click", async () => {
    try {
        const result = await api.launchLocate();
        if (!result.success) {
            alert(
                `Failed to launch locate mode: ${result.reason ?? "Unknown error"}`,
            );
        }
    } catch (error) {
        alert(`Failed to launch locate mode: ${String(error)}`);
    }
});

btnAiChat.addEventListener("click", async () => {
    try {
        const result = await api.launchAiChat();
        if (!result.success) {
            alert(
                `Failed to launch AI Chat mode: ${result.reason ?? "Unknown error"}`,
            );
        }
    } catch (error) {
        alert(`Failed to launch AI Chat mode: ${String(error)}`);
    }
});

btnVersion.addEventListener("click", async () => {
    try {
        const version = await api.getVersion();
        const dialog = document.getElementById(
            "version-dialog",
        ) as HTMLDialogElement;
        const versionText = document.getElementById(
            "version-text",
        ) as HTMLElement;
        versionText.textContent = `Nanalogue-gui version ${version}`;
        dialog.showModal();
    } catch (error) {
        alert(`Failed to get version: ${String(error)}`);
    }
});

// Open external links in the OS browser instead of an Electron window
document
    .getElementById("nanalogue-link")
    ?.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await api.openExternalUrl("https://www.nanalogue.com");
        } catch (error) {
            console.error("Failed to open external URL:", error);
        }
    });

// Close button for the version dialog
document
    .getElementById("version-dialog-close")
    ?.addEventListener("click", () => {
        const dialog = document.getElementById(
            "version-dialog",
        ) as HTMLDialogElement | null;
        dialog?.close();
    });
