// QC mode logic for nanalogue-gui

import { resolve } from "node:path";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import { generateQCData, peekBam } from "../lib/qc-data-loader";
import type { QCConfig, QCData } from "../lib/types";

let qcData: QCData | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Sets the main browser window reference used by IPC handlers for navigation and dialogs.
 *
 * @param window - The main BrowserWindow instance, or null to clear the reference.
 */
export function setMainWindow(window: BrowserWindow | null) {
    mainWindow = window;
}

/**
 * Registers all IPC handlers for the QC mode, including BAM peeking, file selection, and QC generation.
 */
export function registerIpcHandlers() {
    ipcMain.handle(
        "peek-bam",
        async (_event, bamPath: string, treatAsUrl: boolean) => {
            return await peekBam(bamPath, treatAsUrl);
        },
    );

    ipcMain.handle("select-file", async () => {
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

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    });

    ipcMain.handle("generate-qc", async (_event, config: QCConfig) => {
        console.log("Generating QC with config:", {
            ...config,
            sampleFraction: config.sampleFraction / 100,
        });

        // Resolve read ID file path to an array of IDs
        if (config.readIdFilePath) {
            const { readFile } = await import("node:fs/promises");
            const { parseReadIds } = await import("../lib/locate-data-loader");
            const content = await readFile(config.readIdFilePath, "utf-8");
            const parseResult = parseReadIds(content);
            if (parseResult.capped) {
                throw new Error(
                    `Read ID file contains ${parseResult.count.toLocaleString()} unique IDs, exceeding the limit of 200,000.`,
                );
            }
            config.readIdSet = parseResult.ids;
        }

        /**
         * Forwards pagination progress from the worker to the renderer.
         *
         * @param source - The data source that produced this progress event.
         * @param count - The running total of records processed so far.
         */
        const onProgress = (
            source: "reads" | "modifications" | "windows" | "sequences",
            count: number,
        ) => {
            mainWindow?.webContents.send("qc-progress", source, count);
        };

        qcData = await generateQCData(config, onProgress);
        console.log("QC data generated");

        // Navigate to results page
        mainWindow?.loadFile(
            resolve(__dirname, "..", "renderer", "qc", "qc-results.html"),
        );
    });

    ipcMain.handle("get-qc-data", () => {
        return qcData;
    });
}
