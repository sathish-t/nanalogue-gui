// Swipe mode module - handles annotation review workflow

import {
    access,
    appendFile,
    realpath,
    unlink,
    writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { dialog } from "electron";
import { registerTrustedIpcHandler } from "../electron-security";
import { parseBedFile } from "../lib/bed-parser";
import type {
    SwipePlotData,
    SwipeReviewActionResult,
    SwipeReviewState,
    SwipeStartRequest,
} from "../lib/swipe-contract";
import {
    type ContigSizes,
    loadContigSizes,
    loadPlotData,
} from "../lib/swipe-data-loader";
import type { BedAnnotation } from "../lib/types";

/**
 * Configuration arguments for the swipe annotation review mode.
 */
export type SwipeArgs = SwipeStartRequest;

let annotations: BedAnnotation[] = [];
let contigSizes: ContigSizes = {};
let cliArgs: SwipeArgs | null = null;
let modTag: string | undefined;
let modStrand: "bc" | "bc_comp" | undefined;
let regionExpansion: number | undefined;
/** Excludes session initialization and review actions while either is pending. */
let swipeReviewBusy = false;
const appState: SwipeReviewState = {
    currentIndex: 0,
    totalCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
};

/**
 * Initializes the swipe mode by loading contig sizes, parsing annotations, and preparing the output file.
 *
 * @param args - The validated swipe CLI arguments containing file paths and window size.
 * @param overwriteConfirmed - Whether the user already authorized replacing an existing output file.
 * @returns A promise that resolves when initialization is complete.
 */
export async function initializeSwipeReview(
    args: SwipeArgs,
    overwriteConfirmed = false,
): Promise<void> {
    if (swipeReviewBusy) {
        throw new Error(
            "Swipe review is busy. Wait for the current operation to finish and try again.",
        );
    }
    swipeReviewBusy = true;
    try {
        cliArgs = args;
        modTag = args.modTag;
        modStrand = args.modStrand;
        regionExpansion = args.regionExpansion;
        appState.showAnnotationHighlight = args.showAnnotationHighlight;

        // Guard against output path being the same as input BED path
        const outputExistsDuringCollisionCheck = await access(
            cliArgs.outputPath,
        ).then(
            () => true,
            () => false,
        );
        const resolvedBed = await realpath(cliArgs.bedPath);
        const resolvedOutput = resolve(cliArgs.outputPath);
        if (
            outputExistsDuringCollisionCheck &&
            (await realpath(cliArgs.outputPath)) === resolvedBed
        ) {
            throw new Error(
                "Output path resolves to the same file as the input BED path. Choose a different output file to avoid data loss.",
            );
        }
        if (resolvedOutput === resolvedBed) {
            throw new Error(
                "Output path resolves to the same file as the input BED path. Choose a different output file to avoid data loss.",
            );
        }

        console.log("Loading data...");
        console.log(`  BAM: ${cliArgs.bamPath}`);
        console.log(`  BED: ${cliArgs.bedPath}`);
        console.log(`  Output: ${cliArgs.outputPath}`);
        console.log(`  Window size: ${cliArgs.windowSize}`);

        console.log("Reading contig sizes...");
        contigSizes = await loadContigSizes(cliArgs.bamPath);
        console.log(`  Found ${Object.keys(contigSizes).length} contigs`);

        console.log("Parsing BED file...");
        const parseResult = await parseBedFile(cliArgs.bedPath);
        if (parseResult.capped) {
            throw new Error(
                "BED file contains more than 10,000 annotations. Please reduce the file to 10,000 or fewer entries.",
            );
        }
        annotations = parseResult.annotations;
        console.log(`  Found ${annotations.length} annotations`);

        appState.totalCount = annotations.length;
        appState.currentIndex = 0;
        appState.acceptedCount = 0;
        appState.rejectedCount = 0;
        appState.outputPath = cliArgs.outputPath;

        const outputExistsBeforeWrite = await access(cliArgs.outputPath).then(
            () => true,
            () => false,
        );
        if (outputExistsBeforeWrite) {
            if (!overwriteConfirmed) {
                const { response } = await dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Overwrite", "Cancel"],
                    defaultId: 1,
                    title: "File exists",
                    message: `Output file already exists:\n${cliArgs.outputPath}`,
                    detail: "Do you want to overwrite it?",
                });
                if (response === 1) {
                    throw new Error("User cancelled: output file exists");
                }
                overwriteConfirmed = true;
            }
            await unlink(cliArgs.outputPath);
        }
        await writeFile(cliArgs.outputPath, "", {
            encoding: "utf-8",
            flag: overwriteConfirmed ? "w" : "wx",
        });

        console.log("Ready! Opening window...");
    } finally {
        swipeReviewBusy = false;
    }
}

/**
 * Loads the signal plot data for the annotation at the current index.
 *
 * @returns A promise that resolves to the plot data, or null if no more annotations remain or arguments are missing.
 */
async function loadCurrentPlotData(): Promise<SwipePlotData | null> {
    if (!cliArgs) return null;

    if (appState.currentIndex >= annotations.length) {
        return null;
    }

    const annotation = annotations[appState.currentIndex];

    return await loadPlotData(
        cliArgs.bamPath,
        annotation,
        contigSizes,
        cliArgs.windowSize,
        {
            modTag,
            modStrand,
            regionExpansion,
        },
    );
}

/**
 * Appends an accepted annotation line to the output BED file.
 *
 * Throws if the write fails so the caller can surface the error to the user
 * instead of silently losing curated data.
 *
 * @param outputPath - Path to the output BED file.
 * @param rawLine - The raw BED line to append.
 */
async function writeAcceptedAnnotation(
    outputPath: string,
    rawLine: string,
): Promise<void> {
    await appendFile(outputPath, `${rawLine}\n`, "utf-8");
}

/**
 * Advances the review index and loads the next annotation's plot when one remains.
 *
 * @returns The updated review state and next plot, or a completed result at the end.
 */
async function advanceAndLoadNextAnnotation(): Promise<SwipeReviewActionResult> {
    appState.currentIndex++;

    if (appState.currentIndex >= annotations.length) {
        return { done: true, state: appState };
    }

    try {
        const plotData = await loadCurrentPlotData();
        return { done: false, state: appState, plotData };
    } catch (error) {
        console.error(
            `Error loading data for annotation ${appState.currentIndex + 1}:`,
            error,
        );
        return { done: false, state: appState, plotData: null };
    }
}

/**
 * Registers IPC handlers for the renderer process to request state, plot data, and accept or reject annotations.
 */
export function registerSwipeIpcHandlers(): void {
    registerTrustedIpcHandler("get-state", () => {
        return appState;
    });

    registerTrustedIpcHandler("get-plot-data", async () => {
        return await loadCurrentPlotData();
    });

    registerTrustedIpcHandler("accept", async () => {
        if (swipeReviewBusy) {
            throw new Error(
                "Swipe review is busy. Wait for the current operation to finish and try again.",
            );
        }
        swipeReviewBusy = true;
        try {
            if (!cliArgs) {
                console.error(
                    "Unknown state: accept called without cliArgs set",
                );
                return { done: true, state: appState };
            }

            if (appState.currentIndex < annotations.length) {
                const annotation = annotations[appState.currentIndex];
                await writeAcceptedAnnotation(
                    cliArgs.outputPath,
                    annotation.rawLine,
                );
                appState.acceptedCount++;
                return await advanceAndLoadNextAnnotation();
            } else {
                console.error(
                    "Unknown state: accept called even though we've run out of annotations",
                );
            }

            return { done: true, state: appState };
        } finally {
            swipeReviewBusy = false;
        }
    });

    registerTrustedIpcHandler("reject", async () => {
        if (swipeReviewBusy) {
            throw new Error(
                "Swipe review is busy. Wait for the current operation to finish and try again.",
            );
        }
        swipeReviewBusy = true;
        try {
            if (!cliArgs) {
                console.error(
                    "Unknown state: reject called without cliArgs set",
                );
                return { done: true, state: appState };
            }

            if (appState.currentIndex < annotations.length) {
                appState.rejectedCount++;
                return await advanceAndLoadNextAnnotation();
            } else {
                console.error(
                    "Unknown state: reject called even though we've run out of annotations",
                );
            }

            return { done: true, state: appState };
        } finally {
            swipeReviewBusy = false;
        }
    });
}
