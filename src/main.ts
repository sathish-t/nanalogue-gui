// Electron main process for nanalogue-gui with multi-mode support

// Suppress dconf warnings on Linux/WSL by using in-memory GSettings backend
process.env.GSETTINGS_BACKEND ??= "memory";

import { access } from "node:fs/promises";
import { release } from "node:os";
import { resolve } from "node:path";
import {
    app,
    BrowserWindow,
    dialog,
    Menu,
    type UtilityProcess,
    utilityProcess,
} from "electron";
import { version as appVersion } from "../package.json";
import {
    configureElectronSecurityAfterReady,
    configureElectronSecurityBeforeReady,
    getRendererAssetUrl,
    registerTrustedIpcHandler,
} from "./electron-security";
import type { FontSize } from "./font-size";
import { getFontSize, setFontSize } from "./font-size";
import { validateIpcFilePath } from "./lib/ipc-path-validation";
import { countBedDataLines, countNonEmptyLines } from "./lib/line-counter";
import { validateSwipeStartRequest } from "./lib/swipe-contract";

// Prevent Electron from constructing a default menu during application startup.
Menu.setApplicationMenu(null);

configureElectronSecurityBeforeReady();

// Disable GPU acceleration on WSL — the virtual GPU often fails to set up a
// compositing surface, leaving the window visible in the taskbar but unable to
// render.  Software compositing is sufficient for this app (2-D canvas charts,
// CSS animations, DOM updates — no WebGL or 3-D).
if (process.platform === "linux" && /microsoft/i.test(release())) {
    app.disableHardwareAcceleration();
}

/**
 * The application mode representing the current screen of the GUI.
 */
type AppMode = "landing" | "swipe" | "qc" | "locate" | "ai-chat";

/** Lazily loaded shared BAM inspection exports. */
type BamInspectionModeModule = typeof import("./modes/bam-inspection.js");
/** Lazily loaded AI Chat mode exports. */
type AiChatModeModule = typeof import("./modes/ai-chat.js");
/** Lazily loaded Locate mode exports. */
type LocateModeModule = typeof import("./modes/locate.js");
/** Lazily loaded quality control mode exports. */
type QcModeModule = typeof import("./modes/qc.js");
/** Lazily loaded Swipe mode exports. */
type SwipeModeModule = typeof import("./modes/swipe.js");

let currentMode: AppMode = "landing";
let mainWindow: BrowserWindow | null = null;
/** Identifies the newest mode launch so slower imports cannot navigate later. */
let latestModeLaunchRequestId = 0;
let bamInspectionModeModulePromise:
    | Promise<BamInspectionModeModule>
    | undefined;
let aiChatModeModulePromise: Promise<AiChatModeModule> | undefined;
let locateModeModulePromise: Promise<LocateModeModule> | undefined;
let qcModeModulePromise: Promise<QcModeModule> | undefined;
let swipeModeModulePromise: Promise<SwipeModeModule> | undefined;

/**
 * Loads shared BAM inspection only when a configuration page first needs it.
 *
 * @returns The loaded BAM inspection mode module.
 */
async function loadBamInspectionModeModule(): Promise<BamInspectionModeModule> {
    bamInspectionModeModulePromise ??= import("./modes/bam-inspection.js").then(
        (module) => {
            module.registerBamInspectionIpcHandlers();
            return module;
        },
    );
    return bamInspectionModeModulePromise;
}

/**
 * Loads and registers AI Chat only when the user opens that feature.
 *
 * @returns The loaded AI Chat mode module.
 */
async function loadAiChatModeModule(): Promise<AiChatModeModule> {
    aiChatModeModulePromise ??= import("./modes/ai-chat.js").then((module) => {
        module.registerAiChatIpcHandlers();
        return module;
    });
    const module = await aiChatModeModulePromise;
    module.setAiChatMainWindow(mainWindow);
    return module;
}

/**
 * Loads and registers Locate only when the user opens that feature.
 *
 * @returns The loaded Locate mode module.
 */
async function loadLocateModeModule(): Promise<LocateModeModule> {
    locateModeModulePromise ??= import("./modes/locate.js").then((module) => {
        module.registerLocateIpcHandlers();
        return module;
    });
    return locateModeModulePromise;
}

/**
 * Loads and registers QC only when the user opens that feature.
 *
 * @returns The loaded QC mode module.
 */
async function loadQcModeModule(): Promise<QcModeModule> {
    qcModeModulePromise ??= import("./modes/qc.js").then((module) => {
        module.registerQcIpcHandlers();
        return module;
    });
    const module = await qcModeModulePromise;
    module.setQcMainWindow(mainWindow);
    return module;
}

/**
 * Loads and registers Swipe only when the user opens that feature.
 *
 * @returns The loaded Swipe mode module.
 */
async function loadSwipeModeModule(): Promise<SwipeModeModule> {
    swipeModeModulePromise ??= import("./modes/swipe.js").then((module) => {
        module.registerSwipeIpcHandlers();
        return module;
    });
    return swipeModeModulePromise;
}

// --- Global exit failsafe ---
// Fork a watchdog utility process that can force-kill us via SIGKILL.
// Its independent event loop handles a main-process hang after the arm request
// is sent; it cannot recover a main process already blocked before that request.
let exitWatchdog: UtilityProcess | null = null;

/** Prevents duplicate watchdog handshakes during overlapping close events. */
let forceExitStarted = false;

/** Maximum wait for watchdog termination before the main process exits itself. */
const EXIT_WATCHDOG_FALLBACK_MS = 1000;

/**
 * Spawns the exit watchdog utility process and registers signal handlers.
 * Called once at startup; the main process must remain responsive to arm it.
 */
function initExitWatchdog() {
    exitWatchdog = utilityProcess.fork(
        resolve(__dirname, "exit-watchdog.js"),
        [String(process.pid)],
        { serviceName: "nanalogue-exit-watchdog", stdio: "ignore" },
    );

    // Ctrl+C or terminal kill — exit immediately
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
}

/**
 * Arms the watchdog before asking it to kill the parent process.
 * Falls back to direct exit if the utility process does not acknowledge in time.
 */
function forceExit() {
    if (forceExitStarted) return;
    forceExitStarted = true;

    const watchdog = exitWatchdog;
    if (!watchdog) {
        process.exit(0);
        return;
    }

    setTimeout(() => process.exit(0), EXIT_WATCHDOG_FALLBACK_MS);
    watchdog.once("message", (message: unknown) => {
        if (message === "exit-watchdog-armed") {
            watchdog.postMessage("kill-parent");
        }
    });
    watchdog.postMessage("arm-exit-watchdog");
}

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
 * Returns the packaged renderer path for the HTML file for the given mode.
 *
 * @param mode - The application mode to get the HTML path for.
 * @returns The renderer-relative HTML path for the specified mode.
 */
function getRendererPagePath(mode: AppMode): string {
    switch (mode) {
        case "landing":
            return "landing/landing.html";
        case "swipe":
            return "swipe/swipe.html";
        case "qc":
            return "qc/qc-config.html";
        case "locate":
            return "locate/locate-config.html";
        case "ai-chat":
            return "ai-chat/ai-chat.html";
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
 * Measures the intrinsic landing-page content height and resizes the window to
 * match, in both directions (grow and shrink).
 *
 * Two CSS rules pin scrollHeight to the current viewport when content is
 * shorter than the window:
 *   - shared/styles.css sets body { height: 100vh }
 *   - landing.css sets #landing-app { min-height: 100vh }
 * Both are temporarily cleared before measuring and restored immediately after
 * so the layout returns to its normal state without a visible flicker.
 *
 * Guards against navigation races: if the mode is no longer "landing" when
 * the async measurement completes, the resize is skipped.
 *
 * @param win - The BrowserWindow to resize.
 */
async function fitLandingContent(win: BrowserWindow): Promise<void> {
    const contentHeight: number = await win.webContents.executeJavaScript(`
        (function () {
            const app = document.getElementById('landing-app');
            const body = document.body;
            const prevAppMinHeight = app ? app.style.minHeight : '';
            const prevBodyHeight = body.style.height;
            if (app) app.style.minHeight = '0';
            body.style.height = 'auto';
            const h = document.documentElement.scrollHeight;
            if (app) app.style.minHeight = prevAppMinHeight;
            body.style.height = prevBodyHeight;
            return h;
        })()
    `);
    // Guard: the user may have navigated away while the JS was executing.
    if (currentMode !== "landing") return;
    const [contentWidth] = win.getContentSize();
    win.setContentSize(contentWidth, contentHeight);
    win.center();
    if (!win.isVisible()) win.show();
}

/**
 * Adjusts a window's height to match its rendered content.
 * Runs immediately if the page already loaded, otherwise waits for did-finish-load.
 * Uses fitLandingContent so that the min-height: 100vh on #landing-app does
 * not prevent the window from shrinking when a smaller font is active.
 *
 * @param win - The BrowserWindow whose height should adapt to content.
 */
function autoFitHeight(win: BrowserWindow): void {
    if (!win.webContents.isLoading()) {
        void fitLandingContent(win);
        return;
    }
    win.webContents.once("did-finish-load", () => {
        // Guard against mode changes that happened while the page was loading
        if (currentMode !== "landing") return;
        void fitLandingContent(win);
    });
}

/**
 * Creates the main BrowserWindow configured for the specified application mode.
 *
 * @param mode - The application mode to initialize the window for.
 */
function createWindow(mode: AppMode) {
    currentMode = mode;

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
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            webviewTag: false,
        },
        title: getWindowTitle(mode),
    });

    void mainWindow.loadURL(
        getRendererAssetUrl(getRendererPagePath(mode), {
            fontSize: getFontSize(),
        }),
    );

    // Auto-fit the landing page so the window matches its content height
    if (mode === "landing") {
        autoFitHeight(mainWindow);
    }

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    // Global failsafe: force-kill the process when the user closes the window.
    // The close callback must run and send the arm request before the watchdog
    // can protect against a main-event-loop hang.
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

    mainWindow.setSize(width, height);
    mainWindow.center();
    mainWindow.setTitle(getWindowTitle(mode));
    void mainWindow.loadURL(
        getRendererAssetUrl(getRendererPagePath(mode), {
            fontSize: getFontSize(),
        }),
    );

    // Auto-fit the landing page so the window matches its content height
    if (mode === "landing") {
        autoFitHeight(mainWindow);
    }
}

// Landing page IPC handlers

registerTrustedIpcHandler(
    "set-font-size",
    /**
     * Updates the in-memory font size preference used for all subsequent page navigations.
     * The value is never written to disk.
     * When called from the landing page, also re-fits the window height so that
     * the larger or smaller text does not overflow or leave empty space.
     *
     * @param _event - The IPC event (unused).
     * @param size - The requested font size ('small', 'medium', or 'large').
     */
    (_event, size: unknown) => {
        if (size === "small" || size === "medium" || size === "large") {
            setFontSize(size as FontSize);
            if (currentMode === "landing" && mainWindow) {
                void fitLandingContent(mainWindow);
            }
        }
    },
);

registerTrustedIpcHandler(
    "launch-swipe",
    /**
     * Handles the launch-swipe IPC request by navigating to the swipe configuration page.
     *
     * @returns A result object indicating success or failure with an optional reason.
     */
    async () => {
        const launchRequestId = ++latestModeLaunchRequestId;
        if (!mainWindow) return { success: false, reason: "No window" };
        await Promise.all([
            loadSwipeModeModule(),
            loadBamInspectionModeModule(),
        ]);
        if (launchRequestId !== latestModeLaunchRequestId) {
            return { success: true };
        }

        // Set currentMode before loadURL so any concurrent set-font-size
        // IPC call sees the updated mode and skips the landing-only resize.
        currentMode = "swipe";
        const { width, height } = getWindowSize("swipe");
        mainWindow.setSize(width, height);
        mainWindow.center();
        mainWindow.setTitle("nanalogue-swipe");
        void mainWindow.loadURL(
            getRendererAssetUrl("swipe/swipe-config.html", {
                fontSize: getFontSize(),
            }),
        );
        return { success: true };
    },
);

// Shared file-picker IPC handlers (used by swipe, locate, and QC modes)

// Retain the existing Locate channel names; QC also needs these on a cold launch.
registerTrustedIpcHandler("locate-pick-read-ids", async () => {
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
});

registerTrustedIpcHandler(
    "locate-count-read-ids",
    async (_event, filePath: unknown) => {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("Invalid Locate read ID path");
        }
        await validateIpcFilePath(filePath, "read");
        return countNonEmptyLines(filePath);
    },
);

registerTrustedIpcHandler(
    "pick-bam",
    /**
     * Opens a native file dialog for selecting a BAM or CRAM file.
     *
     * @returns The selected file path, or null if cancelled.
     */
    async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Select BAM/CRAM file",
            filters: [
                {
                    name: "Alignment files",
                    extensions: ["bam", "BAM", "cram", "CRAM"],
                },
            ],
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    },
);

registerTrustedIpcHandler(
    "pick-output-bed",
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
        });
        if (result.canceled || !result.filePath) return null;
        return result.filePath;
    },
);

registerTrustedIpcHandler(
    "check-file-exists",
    /**
     * Checks whether a file exists at the given path.
     *
     * @param _event - The IPC event (unused).
     * @param filePath - The path to check.
     * @returns True if the file exists, false otherwise.
     */
    async (_event, filePath: string) => {
        try {
            await access(filePath);
            return true;
        } catch {
            return false;
        }
    },
);

// Swipe config page IPC handlers

registerTrustedIpcHandler(
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

registerTrustedIpcHandler(
    "swipe-count-bed-lines",
    /**
     * Counts BED data lines, skipping header and comment lines.
     *
     * @param _event - The IPC event (unused).
     * @param filePath - The path to the BED file.
     * @returns The number of data lines.
     */
    async (_event, filePath: string) => {
        await validateIpcFilePath(filePath, "read");
        return countBedDataLines(filePath);
    },
);

registerTrustedIpcHandler(
    "swipe-start",
    /**
     * Initializes the swipe module with the provided file paths and navigates to the swipe UI.
     *
     * @param _event - The IPC event (unused).
     * @param payload - Untrusted named Swipe review configuration.
     * @returns A result object indicating success or failure.
     */
    async (_event, payload: unknown) => {
        const swipeArgs = validateSwipeStartRequest(payload);
        await validateIpcFilePath(swipeArgs.bamPath, "read");
        await validateIpcFilePath(swipeArgs.bedPath, "read");
        await validateIpcFilePath(swipeArgs.outputPath, "write");

        try {
            const swipeModule = await loadSwipeModeModule();
            await swipeModule.initializeSwipeReview(
                swipeArgs,
                swipeArgs.overwriteConfirmed,
            );
            resizeAndLoadMode("swipe");
            return { success: true };
        } catch (error) {
            console.error("Failed to initialize swipe mode:", error);
            return { success: false, reason: String(error) };
        }
    },
);

registerTrustedIpcHandler(
    "swipe-go-back",
    /**
     * Navigates back to the landing page from the swipe config screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

registerTrustedIpcHandler(
    "get-app-version",
    /**
     * Returns the application version bundled from package.json.
     *
     * @returns The version string.
     */
    () => appVersion,
);

registerTrustedIpcHandler(
    "launch-qc",
    /**
     * Handles the launch-qc IPC request by switching the application to QC mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        const launchRequestId = ++latestModeLaunchRequestId;
        await Promise.all([loadQcModeModule(), loadBamInspectionModeModule()]);
        if (launchRequestId !== latestModeLaunchRequestId) {
            return { success: true };
        }
        resizeAndLoadMode("qc");
        return { success: true };
    },
);

// QC navigation IPC handlers (registered here to use resizeAndLoadMode)
registerTrustedIpcHandler(
    "qc-go-back",
    /**
     * Handles the qc-go-back IPC request by switching back to the landing page.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

registerTrustedIpcHandler(
    "qc-go-back-to-config",
    /**
     * Handles the qc-go-back-to-config IPC request by switching back to the QC config page.
     */
    () => {
        resizeAndLoadMode("qc");
    },
);

// Locate page IPC handlers

registerTrustedIpcHandler(
    "launch-locate",
    /**
     * Handles the launch-locate IPC request by switching to locate mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        const launchRequestId = ++latestModeLaunchRequestId;
        await Promise.all([
            loadLocateModeModule(),
            loadBamInspectionModeModule(),
        ]);
        if (launchRequestId !== latestModeLaunchRequestId) {
            return { success: true };
        }
        resizeAndLoadMode("locate");
        return { success: true };
    },
);

registerTrustedIpcHandler(
    "locate-go-back",
    /**
     * Navigates back to the landing page from the locate config screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

registerTrustedIpcHandler(
    "launch-ai-chat",
    /**
     * Handles the launch-ai-chat IPC request by switching to AI Chat mode.
     *
     * @returns A result object indicating success.
     */
    async () => {
        const launchRequestId = ++latestModeLaunchRequestId;
        await loadAiChatModeModule();
        if (launchRequestId !== latestModeLaunchRequestId) {
            return { success: true };
        }
        resizeAndLoadMode("ai-chat");
        return { success: true };
    },
);

registerTrustedIpcHandler(
    "ai-chat-go-back-nav",
    /**
     * Navigates back to the landing page from the AI Chat screen.
     */
    () => {
        resizeAndLoadMode("landing");
    },
);

app.whenReady().then(async () => {
    await configureElectronSecurityAfterReady();
    initExitWatchdog();
    createWindow("landing");
});

app.on("window-all-closed", () => {
    forceExit();
});
