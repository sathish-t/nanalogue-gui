// Preload script for nanalogue-gui
// Exposes IPC methods to the renderer process

import { contextBridge, ipcRenderer } from "electron";

// Expose all APIs to all pages. Each page uses what it needs.
// Note: We don't filter by page URL because the project path may contain
// mode names (e.g., "nanalogue-swipe" contains "swipe").
contextBridge.exposeInMainWorld("api", {
    // Landing page

    /**
     * Launch the swipe review mode.
     *
     * @returns A promise that resolves when the swipe window is opened.
     */
    launchSwipe: () => ipcRenderer.invoke("launch-swipe"),

    /**
     * Launch the QC configuration mode.
     *
     * @returns A promise that resolves when the QC window is opened.
     */
    launchQC: () => ipcRenderer.invoke("launch-qc"),

    // Swipe config

    /**
     * Open a native file dialog for selecting a BAM file for swipe mode.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    swipePickBam: () => ipcRenderer.invoke("swipe-pick-bam"),

    /**
     * Open a native file dialog for selecting a BED annotations file for swipe mode.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    swipePickBed: () => ipcRenderer.invoke("swipe-pick-bed"),

    /**
     * Open a native save dialog for selecting the output BED file path.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    swipePickOutput: () => ipcRenderer.invoke("swipe-pick-output"),

    /**
     * Count the number of non-empty lines in a BED file.
     *
     * @param filePath - The path to the BED file.
     * @returns A promise that resolves with the line count.
     */
    swipeCountBedLines: (filePath: string) =>
        ipcRenderer.invoke("swipe-count-bed-lines", filePath),

    /**
     * Check whether a file exists at the given path.
     *
     * @param filePath - The path to check.
     * @returns A promise that resolves with true if the file exists.
     */
    swipeCheckFileExists: (filePath: string) =>
        ipcRenderer.invoke("swipe-check-file-exists", filePath),

    /**
     * Initialize swipe mode and navigate to the swipe review interface.
     *
     * @param bamPath - The path to the BAM file.
     * @param bedPath - The path to the BED annotations file.
     * @param outputPath - The path for the output BED file.
     * @param modTag - The modification tag code to filter by.
     * @param modStrand - The strand convention for modification calls.
     * @param flankingRegion - The number of base pairs to expand the region by on each side.
     * @param showAnnotationHighlight - Whether to show the annotation region highlight box.
     * @param treatAsUrl - Whether to treat the BAM path as a remote URL.
     * @returns A promise that resolves with a result object indicating success or failure.
     */
    swipeStart: (
        bamPath: string,
        bedPath: string,
        outputPath: string,
        modTag?: string,
        modStrand?: "bc" | "bc_comp",
        flankingRegion?: number,
        showAnnotationHighlight?: boolean,
        treatAsUrl?: boolean,
    ) =>
        ipcRenderer.invoke(
            "swipe-start",
            bamPath,
            bedPath,
            outputPath,
            modTag,
            modStrand,
            flankingRegion,
            showAnnotationHighlight,
            treatAsUrl,
        ),

    /**
     * Navigate back to the landing page from the swipe config screen.
     *
     * @returns A promise that resolves when navigation is complete.
     */
    swipeGoBack: () => ipcRenderer.invoke("swipe-go-back"),

    // Swipe mode

    /**
     * Retrieve the current application state for the swipe reviewer.
     *
     * @returns A promise that resolves with the current swipe state object.
     */
    getState: () => ipcRenderer.invoke("get-state"),

    /**
     * Retrieve plot data for the current variant under review.
     *
     * @returns A promise that resolves with the plot data payload.
     */
    getPlotData: () => ipcRenderer.invoke("get-plot-data"),

    /**
     * Accept the current variant in the swipe reviewer.
     *
     * @returns A promise that resolves when the acceptance is recorded.
     */
    accept: () => ipcRenderer.invoke("accept"),

    /**
     * Reject the current variant in the swipe reviewer.
     *
     * @returns A promise that resolves when the rejection is recorded.
     */
    reject: () => ipcRenderer.invoke("reject"),

    // QC config

    /**
     * Peek at a BAM file to extract header and reference information.
     *
     * @param bamPath - The file system path or URL pointing to the BAM file.
     * @param treatAsUrl - Whether to treat the path as a remote URL rather than a local file.
     * @returns A promise that resolves with the extracted BAM metadata.
     */
    peekBam: (bamPath: string, treatAsUrl: boolean) =>
        ipcRenderer.invoke("peek-bam", bamPath, treatAsUrl),

    /**
     * Generate a QC report with the provided configuration options.
     *
     * @param options - A record of configuration key-value pairs for QC generation.
     * @returns A promise that resolves when QC generation is complete.
     */
    generateQC: (options: Record<string, unknown>) =>
        ipcRenderer.invoke("generate-qc", options),

    /**
     * Open a native file selection dialog for choosing an input file.
     *
     * @returns A promise that resolves with the selected file path, or undefined if cancelled.
     */
    selectFile: () => ipcRenderer.invoke("select-file"),

    /**
     * Navigate back from the QC configuration screen to the landing page.
     *
     * @returns A promise that resolves when navigation is complete.
     */
    goBack: () => ipcRenderer.invoke("qc-go-back"),

    // QC results

    /**
     * Retrieve the generated QC results data.
     *
     * @returns A promise that resolves with the QC results payload.
     */
    getQCData: () => ipcRenderer.invoke("get-qc-data"),

    /**
     * Navigate back from the QC results screen to the QC configuration screen.
     *
     * @returns A promise that resolves when navigation is complete.
     */
    goBackToConfig: () => ipcRenderer.invoke("qc-go-back-to-config"),
});
