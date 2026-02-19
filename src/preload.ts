// Preload script for nanalogue-gui
// Exposes IPC methods to the renderer process

import { contextBridge, ipcRenderer } from "electron";

// Expose all APIs to all pages. Each page uses what it needs.
// Note: We don't filter by page URL because the project path may contain
// mode names (e.g., "nanalogue-swipe" contains "swipe").
contextBridge.exposeInMainWorld("api", {
    // Landing page

    /**
     * Returns the application version from package.json.
     *
     * @returns A promise that resolves with the version string.
     */
    getVersion: () => ipcRenderer.invoke("get-app-version"),

    /**
     * Opens a URL in the user's default OS browser.
     *
     * @param url - The URL to open.
     * @returns A promise that resolves when the URL has been handed off to the OS.
     */
    openExternalUrl: (url: string) =>
        ipcRenderer.invoke("open-external-url", url),

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
     * @param windowSize - The number of bases of interest per analysis window.
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
        windowSize: number,
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
            windowSize,
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

    /**
     * Register a listener for QC progress updates during data generation.
     *
     * @param callback - Receives the data source name and running record count.
     * @returns A cleanup function to remove the listener.
     */
    onQCProgress: (callback: (source: string, count: number) => void) => {
        /**
         * Forwards IPC progress events to the provided callback.
         *
         * @param _event - The Electron IPC event (unused).
         * @param source - The data source name (reads, modifications, windows).
         * @param count - The running total of records processed.
         * @returns The result of invoking the callback.
         */
        const handler = (_event: unknown, source: string, count: number) =>
            callback(source, count);
        ipcRenderer.on("qc-progress", handler);
        return () => {
            ipcRenderer.removeListener("qc-progress", handler);
        };
    },

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

    // Locate reads

    /**
     * Launch the locate reads mode.
     *
     * @returns A promise that resolves when the locate window is opened.
     */
    launchLocate: () => ipcRenderer.invoke("launch-locate"),

    /**
     * Open a native file dialog for selecting a BAM file in locate mode.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    locatePickBam: () => ipcRenderer.invoke("locate-pick-bam"),

    /**
     * Open a native file dialog for selecting a read ID text file.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    locatePickReadIds: () => ipcRenderer.invoke("locate-pick-read-ids"),

    /**
     * Open a native save dialog for selecting the output BED file path.
     *
     * @returns A promise that resolves with the selected file path, or null if cancelled.
     */
    locatePickOutput: () => ipcRenderer.invoke("locate-pick-output"),

    /**
     * Check whether a file exists at the given path.
     *
     * @param filePath - The path to check.
     * @returns A promise that resolves with true if the file exists.
     */
    locateCheckFileExists: (filePath: string) =>
        ipcRenderer.invoke("locate-check-file-exists", filePath),

    /**
     * Count the number of non-empty lines in a read ID file.
     *
     * @param filePath - The path to the read ID file.
     * @returns A promise that resolves with the line count.
     */
    locateCountReadIds: (filePath: string) =>
        ipcRenderer.invoke("locate-count-read-ids", filePath),

    /**
     * Generate a BED file from read IDs found in a BAM file.
     *
     * @param bamPath - The path or URL to the BAM file.
     * @param readIdPath - The path to the read ID text file.
     * @param outputPath - The path for the output BED file.
     * @param treatAsUrl - Whether to treat the BAM path as a remote URL.
     * @param region - Optional genomic region to constrain the search.
     * @param fullRegion - Whether to restrict to reads spanning the full region.
     * @returns A promise that resolves with the locate result summary.
     */
    locateGenerateBed: (
        bamPath: string,
        readIdPath: string,
        outputPath: string,
        treatAsUrl: boolean,
        region?: string,
        fullRegion?: boolean,
    ) =>
        ipcRenderer.invoke(
            "locate-generate-bed",
            bamPath,
            readIdPath,
            outputPath,
            treatAsUrl,
            region,
            fullRegion,
        ),

    /**
     * Navigate back to the landing page from the locate config screen.
     *
     * @returns A promise that resolves when navigation is complete.
     */
    locateGoBack: () => ipcRenderer.invoke("locate-go-back"),

    // AI Chat

    /**
     * Launch the AI Chat mode.
     *
     * @returns A promise that resolves when the AI Chat window is opened.
     */
    launchAiChat: () => ipcRenderer.invoke("launch-ai-chat"),

    /**
     * Query the LLM endpoint for available models.
     *
     * @param payload - The endpoint URL and API key.
     * @param payload.endpointUrl - The base URL of the LLM endpoint.
     * @param payload.apiKey - The API key for authentication.
     * @returns A promise with model list or error.
     */
    aiChatListModels: (payload: {
        /** The base URL of the LLM endpoint. */
        endpointUrl: string;
        /** The API key for authentication. */
        apiKey: string;
    }) => ipcRenderer.invoke("ai-chat-list-models", payload),

    /**
     * Send a user message to the AI Chat orchestrator.
     *
     * @param payload - The message, endpoint, model, directory, and config.
     * @param payload.endpointUrl - The base URL of the LLM endpoint.
     * @param payload.apiKey - The API key for authentication.
     * @param payload.model - The model identifier to use.
     * @param payload.message - The user's chat message text.
     * @param payload.allowedDir - The directory the sandbox may access.
     * @param payload.config - Advanced configuration options.
     * @returns A promise with the assistant response.
     */
    aiChatSendMessage: (payload: {
        /** The base URL of the LLM endpoint. */
        endpointUrl: string;
        /** The API key for authentication. */
        apiKey: string;
        /** The model identifier to use. */
        model: string;
        /** The user's chat message text. */
        message: string;
        /** The directory the sandbox may access. */
        allowedDir: string;
        /** Advanced configuration options. */
        config: Record<string, unknown>;
    }) => ipcRenderer.invoke("ai-chat-send-message", payload),

    /**
     * Cancel the current in-flight AI Chat request.
     *
     * @returns A promise that resolves when cancellation is processed.
     */
    aiChatCancel: () => ipcRenderer.invoke("ai-chat-cancel"),

    /**
     * Reset AI Chat conversation state (new chat).
     *
     * @returns A promise that resolves when state is reset.
     */
    aiChatNewChat: () => ipcRenderer.invoke("ai-chat-new-chat"),

    /**
     * Open a native directory picker for BAM analysis directory.
     *
     * @returns A promise with the selected directory path or null.
     */
    aiChatPickDirectory: () => ipcRenderer.invoke("ai-chat-pick-directory"),

    /**
     * Navigate back from AI Chat to the landing page.
     *
     * @returns A promise that resolves when navigation is complete.
     */
    aiChatGoBack: async () => {
        await ipcRenderer.invoke("ai-chat-go-back");
        return ipcRenderer.invoke("ai-chat-go-back-nav");
    },

    /**
     * Record user consent for a non-localhost endpoint origin.
     *
     * @param origin - The endpoint origin string.
     * @returns A promise that resolves when consent is recorded.
     */
    aiChatConsent: (origin: string) =>
        ipcRenderer.invoke("ai-chat-consent", origin),

    /**
     * Register a listener for AI Chat events from the main process.
     *
     * @param callback - The event handler function.
     * @returns A cleanup function to remove the listener.
     */
    onAiChatEvent: (callback: (event: unknown) => void) => {
        /**
         * Forwards IPC events to the provided callback, stripping the Electron event.
         *
         * @param _event - The Electron IPC event (unused).
         * @param data - The AI Chat event payload.
         * @returns The result of invoking the callback.
         */
        const handler = (_event: unknown, data: unknown) => callback(data);
        ipcRenderer.on("ai-chat-event", handler);
        return () => {
            ipcRenderer.removeListener("ai-chat-event", handler);
        };
    },
});
