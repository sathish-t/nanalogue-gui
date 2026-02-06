// Landing page renderer for nanalogue-gui

export {};

/**
 * Defines the preload API exposed to the landing page renderer for launching application modes.
 */
interface LandingApi {
    /** Launches the swipe mode for interactive read annotation review. */
    launchSwipe: () => Promise<void>;
    /** Launches the QC mode for generating quality control reports. */
    launchQC: () => Promise<void>;
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

btnSwipe.addEventListener("click", async () => {
    await api.launchSwipe();
});

btnQC.addEventListener("click", async () => {
    await api.launchQC();
});
