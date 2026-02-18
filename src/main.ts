// Electron main process for nanalogue-gui with multi-mode support

// Suppress dconf warnings on Linux/WSL by using in-memory GSettings backend
process.env.GSETTINGS_BACKEND ??= "memory";

import { type ChildProcess, fork } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { countBedDataLines, countNonEmptyLines } from "./lib/line-counter";
import * as aiChatModule from "./modes/ai-chat";
import * as qcModule from "./modes/qc";
import * as swipeModule from "./modes/swipe";

/**
 * The application mode representing the current screen of the GUI.
 */
type AppMode = "landing" | "swipe" | "qc" | "locate" | "ai-chat";

let currentMode: AppMode = "landing";
let mainWindow: BrowserWindow | null = null;

// --- Global exit failsafe ---
// Fork a watchdog child process that can force-kill us via SIGKILL.
// This works even when the main event loop is blocked by native addon calls,
// because the child process has its own independent event loop.
let exitWatchdog: ChildProcess | null = null;

/**
 * Spawns the exit watchdog child process and registers signal handlers.
 * Called once at startup so the kill switch is always available.
 */
function initExitWatchdog() {
    exitWatchdog = fork(resolve(__dirname, "exit-watchdog.js"), [
        String(process.pid),
    ]);
    exitWatchdog.unref();

    // Ctrl+C or terminal kill — exit immediately
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
}

/**
 * Sends a kill message to the watchdog and also tries process.exit directly.
 * Belt and suspenders: whichever fires first wins.
 */
function forceExit() {
    exitWatchdog?.send("kill");
    process.exit(0);
}

/** The application version read from package.json at startup. */
const APP_VERSION: string = (
    JSON.parse(
        readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
    ) as Record<string, string>
).version;

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
        return { width: 700, height: 500 };
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
        case "locate":
            return resolve(
                __dirname,
                "renderer",
                "locate",
                "locate-config.html",
            );
        case "ai-chat":
            return resolve(__dirname, "renderer", "ai-chat", "ai-chat.html");
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
        case "locate":
            return "nanalogue-locate";
        case "ai-chat":
            return "nanalogue-ai-chat";
    }
}

/**
 * Measures the rendered content height and resizes the window to fit.
 *
 * @param win - The BrowserWindow whose height should adapt to content.
 */
async function fitToContent(win: BrowserWindow): Promise<void> {
    const contentHeight: number = await win.webContents.executeJavaScript(
        "document.documentElement.scrollHeight",
    );
    const [contentWidth] = win.getContentSize();
    win.setContentSize(contentWidth, contentHeight);
    win.center();
    if (!win.isVisible()) win.show();
}

/**
 * Adjusts a window's height to match its rendered content.
 * Runs immediately if the page already loaded, otherwise waits for did-finish-load.
 *
 * @param win - The BrowserWindow whose height should adapt to content.
 */
function autoFitHeight(win: BrowserWindow): void {
    if (!win.webContents.isLoading()) {
        fitToContent(win);
        return;
    }
    win.webContents.once("did-finish-load", () => {
        // Guard against mode changes that happened while the page was loading
        if (currentMode !== "landing") return;
        fitToContent(win);
    });
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
        show: mode !== "landing",
        autoHideMenuBar: true,
        webPreferences: {
            preload: resolve(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: getWindowTitle(mode),
    });

    mainWindow.loadFile(getHtmlPath(mode));

    // Auto-fit the landing page so the window matches its content height
    if (mode === "landing") {
        autoFitHeight(mainWindow);
    }

    // Set main window reference for mode modules
    qcModule.setMainWindow(mainWindow);
    aiChatModule.setMainWindow(mainWindow);

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    // Global failsafe: force-kill the process when the user closes the window.
    // Sends SIGKILL via the watchdog child process, which works even when the
    // main event loop is blocked by long-running native addon calls.
    mainWindow.on("close", () => {
        forceExit();
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
    aiChatModule.setMainWindow(mainWindow);

    mainWindow.setSize(width, height);
    mainWindow.center();
    mainWindow.setTitle(getWindowTitle(mode));
    mainWindow.loadFile(getHtmlPath(mode));

    // Auto-fit the landing page so the window matches its content height
    if (mode === "landing") {
        autoFitHeight(mainWindow);
    }
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
     * @param treatAsUrl - Whether to treat the BAM path as a remote URL.
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
        treatAsUrl?: boolean,
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
            treatAsUrl,
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
    "open-external-url",
    /**
     * Opens a URL in the user's default OS browser after validating it uses a safe scheme.
     * Only http: and https: URLs are allowed; all others are rejected.
     *
     * @param _event - The IPC event (unused).
     * @param url - The URL to open externally.
     * @returns A promise that resolves when the URL has been handed off to the OS.
     */
    (_event: unknown, url: string) => {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`Malformed URL: ${url}`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(
                `Blocked URL with unsupported scheme: ${parsed.protocol}`,
            );
        }
        return shell.openExternal(url);
    },
);

ipcMain.handle(
    "get-app-version",
    /**
     * Returns the application version from package.json.
     *
     * @returns The version string.
     */
    () => APP_VERSION,
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

// Locate page IPC handlers

ipcMain.handle(
    "launch-locate",
    /**
     * Handles the launch-locate IPC request by switching to locate mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        resizeAndLoadMode("locate");
        return { success: true };
    },
);

ipcMain.handle(
    "locate-pick-bam",
    /**
     * Opens a native file dialog for selecting a BAM file in locate mode.
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
    "locate-pick-read-ids",
    /**
     * Opens a native file dialog for selecting a read ID text file.
     *
     * @returns The selected file path, or null if cancelled.
     */
    async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select read ID file",
            filters: [
                { name: "Text files", extensions: ["txt"] },
                { name: "All files", extensions: ["*"] },
            ],
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    },
);

ipcMain.handle(
    "locate-pick-output",
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
            defaultPath: "located_reads.bed",
        });
        if (result.canceled || !result.filePath) return null;
        return result.filePath;
    },
);

ipcMain.handle(
    "locate-check-file-exists",
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
    "locate-count-read-ids",
    /**
     * Counts the number of non-empty lines in a read ID file.
     *
     * @param _event - The IPC event (unused).
     * @param filePath - The path to the read ID file.
     * @returns The number of non-empty lines.
     */
    async (_event, filePath: string) => {
        return countNonEmptyLines(filePath);
    },
);

ipcMain.handle(
    "locate-generate-bed",
    /**
     * Generates a BED file from read IDs found in a BAM file.
     *
     * @param _event - The IPC event (unused).
     * @param bamPath - The path or URL to the BAM file.
     * @param readIdPath - The path to the read ID text file.
     * @param outputPath - The path for the output BED file.
     * @param treatAsUrl - Whether to treat the BAM path as a remote URL.
     * @param region - Optional genomic region to constrain the search.
     * @param fullRegion - Whether to restrict to reads spanning the full region.
     * @returns A summary of the BED generation results.
     */
    async (
        _event,
        bamPath: string,
        readIdPath: string,
        outputPath: string,
        treatAsUrl: boolean,
        region?: string,
        fullRegion?: boolean,
    ) => {
        const { readFileSync, writeFileSync } = await import("node:fs");
        const { parseReadIds, generateBedLines } = await import(
            "./lib/locate-data-loader"
        );
        const { readInfo } = await import("@nanalogue/node");

        const content = readFileSync(readIdPath, "utf-8");
        const parseResult = parseReadIds(content);
        if (parseResult.capped) {
            throw new Error(
                `Read ID file contains ${parseResult.count.toLocaleString()} unique IDs, exceeding the limit of 200,000. Please reduce the file.`,
            );
        }
        const ids = parseResult.ids;

        const options = region
            ? { bamPath, treatAsUrl, readIdSet: ids, region, fullRegion }
            : { bamPath, treatAsUrl, readIdSet: ids };

        const records = await readInfo(options);
        const { lines, summary } = generateBedLines(records, ids.length);

        writeFileSync(
            outputPath,
            lines.length > 0 ? `${lines.join("\n")}\n` : "",
            "utf-8",
        );

        return summary;
    },
);

ipcMain.handle(
    "locate-go-back",
    /**
     * Navigates back to the landing page from the locate config screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

ipcMain.handle(
    "launch-ai-chat",
    /**
     * Handles the launch-ai-chat IPC request by switching to AI Chat mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        resizeAndLoadMode("ai-chat");
        return { success: true };
    },
);

ipcMain.handle(
    "ai-chat-go-back-nav",
    /**
     * Navigates back to the landing page from the AI Chat screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

// Register mode IPC handlers
swipeModule.registerIpcHandlers();
qcModule.registerIpcHandlers();
aiChatModule.registerIpcHandlers();

app.whenReady().then(() => {
    initExitWatchdog();
    createWindow("landing");
});

app.on("window-all-closed", () => {
    forceExit();
});
