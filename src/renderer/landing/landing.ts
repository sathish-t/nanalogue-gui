// Landing page renderer for nanalogue-gui

export {};

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
    /** Launches the swipe mode for interactive read annotation review. */
    launchSwipe: () => Promise<LaunchResult>;
    /** Launches the QC mode for generating quality control reports. */
    launchQC: () => Promise<LaunchResult>;
    /** Launches the locate reads mode for converting read IDs to BED format. */
    launchLocate: () => Promise<LaunchResult>;
}

/** The preload API instance retrieved from the window object for invoking main process actions. */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: LandingApi;
    }
).api;

const btnSwipe = document.getElementById("btn-swipe") as HTMLButtonElement;
const btnQC = document.getElementById("btn-qc") as HTMLButtonElement;
const btnLocate = document.getElementById("btn-locate") as HTMLButtonElement;

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
