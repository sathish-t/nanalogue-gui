import {
    readFileSync,
    realpathSync,
    type Stats,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { readInfo } from "@nanalogue/node";
import { type BrowserWindow, dialog } from "electron";
import { registerTrustedIpcHandler } from "../electron-security";
import { validateIpcFilePath } from "../lib/ipc-path-validation";
import { countNonEmptyLines } from "../lib/line-counter";
import {
    generateBedLines,
    parseReadIds,
    validateLocateGenerateBedRequest,
} from "../lib/locate-data-loader";

let mainWindow: BrowserWindow | null = null;

/**
 * Rejects a Locate output that resolves to the same file as a local input.
 *
 * @param inputPaths - Existing local input paths used by Locate.
 * @param outputPath - Validated destination path about to be written.
 */
function assertLocateOutputIsNotInput(
    inputPaths: string[],
    outputPath: string,
): void {
    let canonicalOutputPath: string;
    let outputIdentity: Pick<Stats, "dev" | "ino"> | undefined;
    try {
        canonicalOutputPath = realpathSync(outputPath);
        outputIdentity = statSync(outputPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        canonicalOutputPath = join(
            realpathSync(dirname(outputPath)),
            basename(outputPath),
        );
    }

    for (const inputPath of inputPaths) {
        const inputIdentity = statSync(inputPath);
        const hasSameCanonicalPath =
            realpathSync(inputPath) === canonicalOutputPath;
        const hasSameFileIdentity =
            outputIdentity !== undefined &&
            inputIdentity.dev === outputIdentity.dev &&
            inputIdentity.ino === outputIdentity.ino;
        if (hasSameCanonicalPath || hasSameFileIdentity) {
            throw new Error(
                "Locate output path resolves to the same file as an input. Choose a different output file to avoid data loss.",
            );
        }
    }
}

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
        "locate-generate-bed",
        async (_event, payload: unknown) => {
            const request = validateLocateGenerateBedRequest(payload);
            const { bamPath, readIdPath, outputPath, region, fullRegion } =
                request;
            await validateIpcFilePath(bamPath, "read");
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
                      readIdSet: parseResult.ids,
                      region,
                      fullRegion,
                  }
                : { bamPath, readIdSet: parseResult.ids };
            const records = await readInfo(options);
            const { lines, summary } = generateBedLines(
                records,
                parseResult.ids.length,
            );
            // Recheck filesystem identity at the write boundary. A hostile process
            // can still replace a parent directory after this check; Node does not
            // expose an openat-style API for anchoring traversal to a directory fd.
            assertLocateOutputIsNotInput([bamPath, readIdPath], outputPath);
            // "wx" creates the file exclusively, failing instead of truncating it
            // if it appeared after the renderer's existence check.
            writeFileSync(
                outputPath,
                lines.length > 0 ? `${lines.join("\n")}\n` : "",
                {
                    encoding: "utf-8",
                    flag: request.overwriteConfirmed ? "w" : "wx",
                },
            );
            return summary;
        },
    );
}
