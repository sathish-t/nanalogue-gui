// Electron main process for nanalogue-gui with multi-mode support

// Suppress dconf warnings on Linux/WSL by using in-memory GSettings backend
process.env.GSETTINGS_BACKEND ??= "memory";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { countBedDataLines } from "./lib/line-counter";
import * as qcModule from "./modes/qc";
import * as swipeModule from "./modes/swipe";

/**
 * The application mode representing the current screen of the GUI.
 */
type AppMode = "landing" | "swipe" | "qc";

let currentMode: AppMode = "landing";
let mainWindow: BrowserWindow | null = null;

/**
 * Returns the window dimensions appropriate for the given application mode.
 *
 * @param mode - The application mode to determine window size for.
 * @returns An object with width and height properties in pixels.
 */
function getWindowSize(mode: AppMode): {
    /** The window width in pixels. */
    width: number;
    /** The window height in pixels. */
    height: number;
} {
    if (mode === "landing") {
        return { width: 500, height: 400 };
    }
    return { width: 1000, height: 700 };
}

/**
 * Resolves the absolute file path to the HTML file for the given mode.
 *
 * @param mode - The application mode to get the HTML path for.
 * @returns The absolute path to the HTML file for the specified mode.
 */
function getHtmlPath(mode: AppMode): string {
    switch (mode) {
        case "landing":
            return resolve(__dirname, "renderer", "landing", "landing.html");
        case "swipe":
            return resolve(__dirname, "renderer", "swipe", "swipe.html");
        case "qc":
            return resolve(__dirname, "renderer", "qc", "qc-config.html");
    }
}

/**
 * Returns the window title string for the given application mode.
 *
 * @param mode - The application mode to get the title for.
 * @returns The window title corresponding to the specified mode.
 */
function getWindowTitle(mode: AppMode): string {
    switch (mode) {
        case "landing":
            return "nanalogue-gui";
        case "swipe":
            return "nanalogue-swipe";
        case "qc":
            return "nanalogue-qc";
    }
}

/**
 * Creates the main BrowserWindow configured for the specified application mode.
 *
 * @param mode - The application mode to initialize the window for.
 */
function createWindow(mode: AppMode) {
    currentMode = mode;
    Menu.setApplicationMenu(null);

    const { width, height } = getWindowSize(mode);

    mainWindow = new BrowserWindow({
        width,
        height,
        autoHideMenuBar: true,
        webPreferences: {
            preload: resolve(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: getWindowTitle(mode),
    });

    mainWindow.loadFile(getHtmlPath(mode));

    // Set main window reference for mode modules
    qcModule.setMainWindow(mainWindow);

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

/**
 * Resizes the existing main window and loads the HTML for the specified mode.
 *
 * @param mode - The application mode to switch to.
 */
function resizeAndLoadMode(mode: AppMode) {
    if (!mainWindow) return;

    currentMode = mode;
    const { width, height } = getWindowSize(mode);

    // Update module window references when changing modes
    qcModule.setMainWindow(mainWindow);

    mainWindow.setSize(width, height);
    mainWindow.center();
    mainWindow.setTitle(getWindowTitle(mode));
    mainWindow.loadFile(getHtmlPath(mode));
}

// Landing page IPC handlers
ipcMain.handle(
    "launch-swipe",
    /**
     * Handles the launch-swipe IPC request by navigating to the swipe configuration page.
     *
     * @returns A result object indicating success or failure with an optional reason.
     */
    async () => {
        if (!mainWindow) return { success: false, reason: "No window" };

        const { width, height } = getWindowSize("swipe");
        mainWindow.setSize(width, height);
        mainWindow.center();
        mainWindow.setTitle("nanalogue-swipe");
        mainWindow.loadFile(
            resolve(__dirname, "renderer", "swipe", "swipe-config.html"),
        );
        return { success: true };
    },
);

// Swipe config page IPC handlers

ipcMain.handle(
    "swipe-pick-bam",
    /**
     * Opens a native file dialog for selecting a BAM file.
     *
     * @returns The selected file path, or null if cancelled.
     */
    async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select BAM file",
            filters: [{ name: "BAM files", extensions: ["bam"] }],
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    },
);

ipcMain.handle(
    "swipe-pick-bed",
    /**
     * Opens a native file dialog for selecting a BED annotations file.
     *
     * @returns The selected file path, or null if cancelled.
     */
    async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select BED annotations file",
            filters: [{ name: "BED files", extensions: ["bed"] }],
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    },
);

ipcMain.handle(
    "swipe-pick-output",
    /**
     * Opens a native save dialog for selecting the output BED file path.
     *
     * @returns The selected file path, or null if cancelled.
     */
    async () => {
        if (!mainWindow) return null;
        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Select output BED file",
            filters: [{ name: "BED files", extensions: ["bed"] }],
            defaultPath: "accepted_annotations.bed",
        });
        if (result.canceled || !result.filePath) return null;
        return result.filePath;
    },
);

ipcMain.handle(
    "swipe-count-bed-lines",
    /**
     * Counts BED data lines, skipping header and comment lines.
     *
     * @param _event - The IPC event (unused).
     * @param filePath - The path to the BED file.
     * @returns The number of data lines.
     */
    async (_event, filePath: string) => {
        return countBedDataLines(filePath);
    },
);

ipcMain.handle(
    "swipe-check-file-exists",
    /**
     * Checks whether a file exists at the given path.
     *
     * @param _event - The IPC event (unused).
     * @param filePath - The path to check.
     * @returns True if the file exists, false otherwise.
     */
    (_event, filePath: string) => {
        return existsSync(filePath);
    },
);

ipcMain.handle(
    "swipe-start",
    /**
     * Initializes the swipe module with the provided file paths and navigates to the swipe UI.
     *
     * @param _event - The IPC event (unused).
     * @param bamPath - The path to the BAM file.
     * @param bedPath - The path to the BED annotations file.
     * @param outputPath - The path for the output BED file.
     * @param modTag - The modification tag code to filter by.
     * @param modStrand - The strand convention for modification calls.
     * @param flankingRegion - The number of base pairs to expand the region by on each side.
     * @param showAnnotationHighlight - Whether to show the annotation region highlight box.
     * @returns A result object indicating success or failure.
     */
    async (
        _event,
        bamPath: string,
        bedPath: string,
        outputPath: string,
        modTag?: string,
        modStrand?: "bc" | "bc_comp",
        flankingRegion?: number,
        showAnnotationHighlight?: boolean,
    ) => {
        const swipeArgs: swipeModule.SwipeArgs = {
            bamPath,
            bedPath,
            outputPath,
            windowSize: 300,
            modTag,
            modStrand,
            regionExpansion: flankingRegion,
            showAnnotationHighlight,
        };

        try {
            await swipeModule.initialize(swipeArgs, true);
            resizeAndLoadMode("swipe");
            return { success: true };
        } catch (error) {
            console.error("Failed to initialize swipe mode:", error);
            return { success: false, reason: String(error) };
        }
    },
);

ipcMain.handle(
    "swipe-go-back",
    /**
     * Navigates back to the landing page from the swipe config screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

ipcMain.handle(
    "launch-qc",
    /**
     * Handles the launch-qc IPC request by switching the application to QC mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        resizeAndLoadMode("qc");
        return { success: true };
    },
);

// QC navigation IPC handlers (registered here to use resizeAndLoadMode)
ipcMain.handle(
    "qc-go-back",
    /**
     * Handles the qc-go-back IPC request by switching back to the landing page.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

ipcMain.handle(
    "qc-go-back-to-config",
    /**
     * Handles the qc-go-back-to-config IPC request by switching back to the QC config page.
     */
    () => {
        resizeAndLoadMode("qc");
    },
);

// Register mode IPC handlers
swipeModule.registerIpcHandlers();
qcModule.registerIpcHandlers();

app.whenReady().then(() => {
    createWindow("landing");
});

app.on("window-all-closed", () => {
    if (currentMode === "swipe") {
        swipeModule.printSummary();
    }
    app.quit();
});
