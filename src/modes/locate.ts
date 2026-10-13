import type { Stats } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readInfo } from "@nanalogue/node";
import { ipcMain } from "electron";
import { validateIpcFilePath } from "../lib/ipc-path-validation";
import {
    generateBedLines,
    parseReadIds,
    validateLocateGenerateBedRequest,
} from "../lib/locate-data-loader";

/** Allows only one Locate generation, including its output write, at a time. */
let locateGenerationBusy = false;

/**
 * Rejects a Locate output that resolves to the same file as a local input.
 *
 * @param inputPaths - Existing local input paths used by Locate.
 * @param outputPath - Validated destination path about to be written.
 */
async function assertLocateOutputIsNotInput(
    inputPaths: string[],
    outputPath: string,
): Promise<void> {
    let canonicalOutputPath: string;
    let outputIdentity: Pick<Stats, "dev" | "ino"> | undefined;
    try {
        canonicalOutputPath = await realpath(outputPath);
        outputIdentity = await stat(outputPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        canonicalOutputPath = join(
            await realpath(dirname(outputPath)),
            basename(outputPath),
        );
    }

    for (const inputPath of inputPaths) {
        const inputIdentity = await stat(inputPath);
        const hasSameCanonicalPath =
            (await realpath(inputPath)) === canonicalOutputPath;
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

/** Registers Locate-owned IPC handlers. */
export function registerLocateIpcHandlers(): void {
    ipcMain.handle("locate-generate-bed", async (_event, payload: unknown) => {
        if (locateGenerationBusy) {
            throw new Error(
                "Locate generation is busy. Wait for the current operation to finish and try again.",
            );
        }
        locateGenerationBusy = true;
        try {
            const request = validateLocateGenerateBedRequest(payload);
            const { bamPath, readIdPath, outputPath, region, fullRegion } =
                request;
            await validateIpcFilePath(bamPath, "read");
            await validateIpcFilePath(readIdPath, "read");
            await validateIpcFilePath(outputPath, "write");

            const parseResult = parseReadIds(
                await readFile(readIdPath, "utf-8"),
            );
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
            await assertLocateOutputIsNotInput(
                [bamPath, readIdPath],
                outputPath,
            );
            // "wx" creates the file exclusively, failing instead of truncating it
            // if it appeared after the renderer's existence check.
            await writeFile(
                outputPath,
                lines.length > 0 ? `${lines.join("\n")}\n` : "",
                {
                    encoding: "utf-8",
                    flag: request.overwriteConfirmed ? "w" : "wx",
                },
            );
            return summary;
        } finally {
            locateGenerationBusy = false;
        }
    });
}
