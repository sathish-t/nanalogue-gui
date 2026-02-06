// Swipe mode module - handles annotation review workflow

import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ipcMain } from "electron";
import { parseBedFile } from "../lib/bed-parser";
import {
    type ContigSizes,
    loadContigSizes,
    loadPlotData,
} from "../lib/data-loader";
import type { AppState, BedAnnotation, PlotData } from "../lib/types";

/**
 * Command-line arguments for the swipe annotation review mode.
 */
export interface SwipeCliArgs {
    /** Path to the BAM file containing nanopore signal data. */
    bamPath: string;
    /** Path to the BED file containing base modification annotations. */
    bedPath: string;
    /** Path for the output BED file where accepted annotations are written. */
    outputPath: string;
    /** Window size in base pairs around each annotation for the signal plot. */
    windowSize: number;
}

let annotations: BedAnnotation[] = [];
let contigSizes: ContigSizes = {};
let cliArgs: SwipeCliArgs | null = null;
const appState: AppState = {
    currentIndex: 0,
    totalCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
};

/**
 * Parses command-line arguments for swipe mode and validates input files.
 *
 * @param args - The positional and optional arguments following the swipe subcommand.
 * @returns The parsed and validated swipe CLI arguments.
 */
export function parseSwipeArgs(args: string[]): SwipeCliArgs {
    if (args.length < 3) {
        console.error(
            "Usage: nanalogue-swipe swipe <bam_file> <annotations_bed> <output_file> [--win <size>]",
        );
        console.error("");
        console.error("Arguments:");
        console.error("  bam_file        Path to BAM file");
        console.error("  annotations_bed Path to BED file with annotations");
        console.error(
            "  output_file     Path for output BED file (accepted annotations)",
        );
        console.error("  --win, -w       Window size in bp (default: 300)");
        process.exit(1);
    }

    const bamPath = resolve(args[0]);
    const bedPath = resolve(args[1]);
    const outputPath = resolve(args[2]);
    let windowSize = 300;

    for (let i = 3; i < args.length; i++) {
        if (args[i] === "--win" || args[i] === "-w") {
            const next = args[i + 1];
            if (next) {
                const parsed = parseInt(next, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    windowSize = parsed;
                    i++;
                } else {
                    console.error(`Invalid window size: ${next}`);
                    process.exit(1);
                }
            }
        }
    }

    if (!existsSync(bamPath)) {
        console.error(`BAM file not found: ${bamPath}`);
        process.exit(1);
    }

    if (!existsSync(bedPath)) {
        console.error(`BED file not found: ${bedPath}`);
        process.exit(1);
    }

    return { bamPath, bedPath, outputPath, windowSize };
}

/**
 * Initializes the swipe mode by loading contig sizes, parsing annotations, and preparing the output file.
 *
 * @param args - The validated swipe CLI arguments containing file paths and window size.
 * @returns A promise that resolves when initialization is complete.
 */
export async function initialize(args: SwipeCliArgs): Promise<void> {
    cliArgs = args;

    console.log("Loading data...");
    console.log(`  BAM: ${cliArgs.bamPath}`);
    console.log(`  BED: ${cliArgs.bedPath}`);
    console.log(`  Output: ${cliArgs.outputPath}`);
    console.log(`  Window size: ${cliArgs.windowSize}`);

    console.log("Reading contig sizes...");
    contigSizes = await loadContigSizes(cliArgs.bamPath);
    console.log(`  Found ${Object.keys(contigSizes).length} contigs`);

    console.log("Parsing BED file...");
    annotations = parseBedFile(cliArgs.bedPath);
    console.log(`  Found ${annotations.length} annotations`);

    appState.totalCount = annotations.length;
    appState.currentIndex = 0;
    appState.acceptedCount = 0;
    appState.rejectedCount = 0;

    if (existsSync(cliArgs.outputPath)) {
        unlinkSync(cliArgs.outputPath);
    }
    writeFileSync(cliArgs.outputPath, "", "utf-8");

    console.log("Ready! Opening window...");
}

/**
 * Loads the signal plot data for the annotation at the current index.
 *
 * @returns A promise that resolves to the plot data, or null if no more annotations remain or arguments are missing.
 */
async function loadCurrentPlotData(): Promise<PlotData | null> {
    if (!cliArgs) return null;

    if (appState.currentIndex >= annotations.length) {
        return null;
    }

    const annotation = annotations[appState.currentIndex];

    try {
        return await loadPlotData(
            cliArgs.bamPath,
            annotation,
            contigSizes,
            cliArgs.windowSize,
        );
    } catch (error) {
        console.error(
            `Error loading data for annotation ${appState.currentIndex + 1}:`,
            error,
        );
        return null;
    }
}

/**
 * Appends an accepted annotation to the output BED file.
 *
 * @param annotation - The BED annotation that was accepted by the user.
 */
function writeAcceptedAnnotation(annotation: BedAnnotation) {
    if (!cliArgs) return;
    try {
        appendFileSync(cliArgs.outputPath, `${annotation.rawLine}\n`, "utf-8");
    } catch (error) {
        console.error("Error writing annotation:", error);
    }
}

/**
 * Registers IPC handlers for the renderer process to request state, plot data, and accept or reject annotations.
 */
export function registerIpcHandlers(): void {
    ipcMain.handle("get-state", () => {
        return appState;
    });

    ipcMain.handle("get-plot-data", async () => {
        return await loadCurrentPlotData();
    });

    ipcMain.handle("accept", async () => {
        if (!cliArgs) return { done: true, state: appState };

        if (appState.currentIndex < annotations.length) {
            const annotation = annotations[appState.currentIndex];
            writeAcceptedAnnotation(annotation);
            appState.acceptedCount++;
            appState.currentIndex++;
        }

        if (appState.currentIndex >= annotations.length) {
            return { done: true, state: appState };
        }

        const plotData = await loadCurrentPlotData();
        return { done: false, state: appState, plotData };
    });

    ipcMain.handle("reject", async () => {
        if (!cliArgs) return { done: true, state: appState };

        if (appState.currentIndex < annotations.length) {
            appState.rejectedCount++;
            appState.currentIndex++;
        }

        if (appState.currentIndex >= annotations.length) {
            return { done: true, state: appState };
        }

        const plotData = await loadCurrentPlotData();
        return { done: false, state: appState, plotData };
    });
}

/**
 * Prints a summary of the review session to the console, including counts of reviewed, accepted, and rejected annotations.
 */
export function printSummary(): void {
    console.log("");
    console.log("Session complete:");
    console.log(
        `  Reviewed: ${appState.currentIndex} / ${appState.totalCount}`,
    );
    console.log(`  Accepted: ${appState.acceptedCount}`);
    console.log(`  Rejected: ${appState.rejectedCount}`);
    if (cliArgs) {
        console.log(`  Output: ${cliArgs.outputPath}`);
    }
}
