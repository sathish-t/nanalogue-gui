// QC mode logic for nanalogue-gui

import {
    createReadStream,
    createWriteStream,
    existsSync,
    realpathSync,
    rmSync,
    statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import { generateQCData, peekBam } from "../lib/qc-data-loader";
import type { QCConfig, QCData } from "../lib/types";

let qcData: QCData | null = null;
let mainWindow: BrowserWindow | null = null;
/** Path to the current temp directory holding per-read TSV data. */
let tempDir: string | null = null;

/**
 * Sets the main browser window reference used by IPC handlers for navigation and dialogs.
 *
 * @param window - The main BrowserWindow instance, or null to clear the reference.
 */
export function setMainWindow(window: BrowserWindow | null) {
    mainWindow = window;
}

/**
 * Removes the temporary directory created during QC data generation.
 */
export function cleanup(): void {
    if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
        console.log(`Cleaned up temp directory: ${tempDir}`);
        tempDir = null;
    }
}

/**
 * Reads a TSV file line-by-line, optionally filtering rows by a numeric column range,
 * and writes the result to the destination path.
 *
 * @param sourcePath - The path to the source TSV file.
 * @param destPath - The path to write the filtered TSV output.
 * @param filterMin - The inclusive lower bound for filtering (undefined to skip filtering).
 * @param filterMax - The exclusive upper bound for filtering (undefined to skip filtering).
 * @param valueColumnIndex - The zero-based column index containing the numeric value to filter on.
 * @returns A promise that resolves when writing is complete.
 */
export async function filterAndWriteTsv(
    sourcePath: string,
    destPath: string,
    filterMin: number | undefined,
    filterMax: number | undefined,
    valueColumnIndex: number,
): Promise<void> {
    // Capture narrowed filter bounds so TypeScript knows they are numbers inside the callback
    const doFilter = filterMin !== undefined && filterMax !== undefined;
    const low = filterMin ?? 0;
    const high = filterMax ?? 0;

    return new Promise((resolvePromise, reject) => {
        const input = createReadStream(sourcePath, "utf-8");
        const output = createWriteStream(destPath, "utf-8");
        const rl = createInterface({
            input,
            crlfDelay: Number.POSITIVE_INFINITY,
        });

        let settled = false;

        /**
         * Destroys both streams and rejects the promise once.
         *
         * @param err - The error that triggered the failure.
         */
        function fail(err: Error) {
            if (settled) return;
            settled = true;
            rl.close();
            input.destroy();
            output.destroy();
            reject(err);
        }

        let isHeader = true;

        rl.on("line", (line) => {
            if (isHeader) {
                output.write(`${line}\n`);
                isHeader = false;
                return;
            }

            if (!doFilter) {
                output.write(`${line}\n`);
                return;
            }

            const fields = line.split("\t");
            const value = parseFloat(fields[valueColumnIndex]);
            if (Number.isFinite(value) && value >= low && value < high) {
                output.write(`${line}\n`);
            }
        });

        rl.on("close", () => {
            output.end(() => resolvePromise());
        });

        input.on("error", fail);
        rl.on("error", fail);
        output.on("error", fail);
    });
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
            title: "Select BAM file",
            filters: [{ name: "BAM files", extensions: ["bam"] }],
            properties: ["openFile"],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    });

    ipcMain.handle("generate-qc", async (_event, config: QCConfig) => {
        // Clean up previous temp files before generating new data
        cleanup();

        console.log("Generating QC with config:", {
            ...config,
            sampleFraction: config.sampleFraction / 100,
        });
        qcData = await generateQCData(config);
        console.log("QC data generated");

        // Track the temp directory for cleanup
        if (qcData.wholeReadDensityTsvPath) {
            tempDir = resolve(qcData.wholeReadDensityTsvPath, "..");
        }

        // Navigate to results page
        mainWindow?.loadFile(
            resolve(__dirname, "..", "renderer", "qc", "qc-results.html"),
        );
    });

    ipcMain.handle("get-qc-data", () => {
        return qcData;
    });

    ipcMain.handle(
        "download-qc-reads",
        async (
            _event,
            tempTsvPath: string,
            filterMin?: number,
            filterMax?: number,
            valueColumnIndex?: number,
        ) => {
            if (!mainWindow) return false;

            // Validate that the source path is a regular file within the QC temp directory.
            // Uses realpathSync to resolve symlinks before checking containment.
            if (!tempDir) {
                console.error("Rejected download: no QC temp directory exists");
                return false;
            }
            const resolvedPath = resolve(tempTsvPath);
            if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
                console.error(
                    `Rejected download request for missing or non-file path: ${tempTsvPath}`,
                );
                return false;
            }
            const realPath = realpathSync(resolvedPath);
            const realTempDir = realpathSync(tempDir);
            const rel = relative(realTempDir, realPath);
            if (rel.startsWith("..") || isAbsolute(rel)) {
                console.error(
                    `Rejected download request for path outside QC temp dir: ${tempTsvPath}`,
                );
                return false;
            }

            const result = await dialog.showSaveDialog(mainWindow, {
                title: "Save reads as TSV",
                filters: [{ name: "TSV files", extensions: ["tsv"] }],
                defaultPath: "whole_read_density.tsv",
            });

            if (result.canceled || !result.filePath) return false;

            // Prevent writing to the same file we're reading from
            const destResolved = resolve(result.filePath);
            if (
                existsSync(destResolved) &&
                realpathSync(destResolved) === realPath
            ) {
                console.error(
                    "Rejected download: destination is the same as source",
                );
                return false;
            }

            // On Linux the native save dialog may not confirm overwrites
            if (existsSync(result.filePath)) {
                const confirm = await dialog.showMessageBox(mainWindow, {
                    type: "question",
                    buttons: ["Overwrite", "Cancel"],
                    defaultId: 1,
                    title: "File already exists",
                    message: `"${result.filePath}" already exists. Do you want to overwrite it?`,
                });
                if (confirm.response !== 0) return false;
            }

            try {
                await filterAndWriteTsv(
                    realPath,
                    result.filePath,
                    filterMin,
                    filterMax,
                    valueColumnIndex ?? 1,
                );
            } catch (err) {
                console.error(
                    `Failed to write TSV (source=${realPath}, dest=${result.filePath}, ` +
                        `filter=${filterMin}..${filterMax}):`,
                    err,
                );
                return false;
            }

            return true;
        },
    );
}
