import { readFileSync, writeFileSync } from "node:fs";
import { readInfo } from "@nanalogue/node";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import { validateIpcFilePath } from "../lib/ipc-path-validation";
import { countNonEmptyLines } from "../lib/line-counter";
import {
    generateBedLines,
    parseReadIds,
    validateLocateGenerateBedRequest,
} from "../lib/locate-data-loader";

let mainWindow: BrowserWindow | null = null;

/**
 * Updates the window used as parent for Locate dialogs.
 *
 * @param window - The current application window, or null when unavailable.
 */
export function setLocateMainWindow(window: BrowserWindow | null): void {
    mainWindow = window;
}

/** Registers Locate-owned IPC handlers. */
export function registerLocateIpcHandlers(): void {
    ipcMain.handle("locate-pick-read-ids", async () => {
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

    ipcMain.handle(
        "locate-count-read-ids",
        async (_event, filePath: unknown) => {
            if (typeof filePath !== "string" || filePath.length === 0) {
                throw new Error("Invalid Locate read ID path");
            }
            await validateIpcFilePath(filePath, "read");
            return countNonEmptyLines(filePath);
        },
    );

    ipcMain.handle("locate-generate-bed", async (_event, payload: unknown) => {
        const request = validateLocateGenerateBedRequest(payload);
        const {
            bamPath,
            readIdPath,
            outputPath,
            treatAsUrl,
            region,
            fullRegion,
        } = request;
        if (!treatAsUrl) await validateIpcFilePath(bamPath, "read");
        await validateIpcFilePath(readIdPath, "read");
        await validateIpcFilePath(outputPath, "write");

        const parseResult = parseReadIds(readFileSync(readIdPath, "utf-8"));
        if (parseResult.capped) {
            throw new Error(
                `Read ID file contains ${parseResult.count.toLocaleString()} unique IDs, exceeding the limit of 200,000. Please reduce the file.`,
            );
        }
        const options = region
            ? {
                  bamPath,
                  treatAsUrl,
                  readIdSet: parseResult.ids,
                  region,
                  fullRegion,
              }
            : { bamPath, treatAsUrl, readIdSet: parseResult.ids };
        const records = await readInfo(options);
        const { lines, summary } = generateBedLines(
            records,
            parseResult.ids.length,
        );
        writeFileSync(
            outputPath,
            lines.length > 0 ? `${lines.join("\n")}\n` : "",
            "utf-8",
        );
        return summary;
    });
}
