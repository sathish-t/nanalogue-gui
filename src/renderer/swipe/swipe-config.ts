// Swipe configuration page renderer

export {};

/**
 * Result returned by the peek-bam IPC handler.
 */
interface PeekResult {
    /** Example contig names from the BAM header. */
    contigs: string[];
    /** The total number of contigs in the BAM header. */
    totalContigs: number;
    /** The modification types detected in the BAM file. */
    modifications: string[];
}

/**
 * Result returned by mode launch IPC handlers.
 */
interface LaunchResult {
    /** Whether the launch succeeded. */
    success: boolean;
    /** The reason for failure when success is false. */
    reason?: string;
}

/**
 * Defines the preload API exposed to the swipe config renderer.
 */
interface SwipeConfigApi {
    /** Opens a native file dialog for selecting a BAM file. */
    swipePickBam: () => Promise<string | null>;
    /** Opens a native file dialog for selecting a BED file. */
    swipePickBed: () => Promise<string | null>;
    /** Opens a native save dialog for selecting the output file path. */
    swipePickOutput: () => Promise<string | null>;
    /** Counts the number of non-empty lines in a BED file. */
    swipeCountBedLines: (filePath: string) => Promise<number>;
    /** Checks whether a file exists at the given path. */
    swipeCheckFileExists: (filePath: string) => Promise<boolean>;
    /** Peeks at a BAM file to extract header metadata. */
    peekBam: (bamPath: string, treatAsUrl: boolean) => Promise<PeekResult>;
    /** Initializes swipe mode and navigates to the review interface. */
    swipeStart: (
        bamPath: string,
        bedPath: string,
        outputPath: string,
    ) => Promise<LaunchResult>;
    /** Navigates back to the landing page. */
    swipeGoBack: () => Promise<void>;
}

/**
 * Preload-bridged API for communicating with the main process.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: SwipeConfigApi;
    }
).api;

/**
 * Cached references to DOM elements used throughout the config page.
 */
const elements = {
    /** BAM file path input. */
    bamPath: document.getElementById("bam-path") as HTMLInputElement,
    /** BED file path input. */
    bedPath: document.getElementById("bed-path") as HTMLInputElement,
    /** Output file path input. */
    outputPath: document.getElementById("output-path") as HTMLInputElement,
    /** Browse button for BAM file. */
    btnBrowseBam: document.getElementById(
        "btn-browse-bam",
    ) as HTMLButtonElement,
    /** Browse button for BED file. */
    btnBrowseBed: document.getElementById(
        "btn-browse-bed",
    ) as HTMLButtonElement,
    /** Browse button for output file. */
    btnBrowseOutput: document.getElementById(
        "btn-browse-output",
    ) as HTMLButtonElement,
    /** Start swiping button. */
    btnStart: document.getElementById("btn-start") as HTMLButtonElement,
    /** Back button. */
    btnBack: document.getElementById("btn-back") as HTMLButtonElement,
    /** File summary panel. */
    fileSummary: document.getElementById("file-summary") as HTMLElement,
    /** File exists warning text. */
    fileExistsWarning: document.getElementById(
        "file-exists-warning",
    ) as HTMLElement,
    /** Overwrite confirmation label container. */
    overwriteConfirm: document.getElementById(
        "overwrite-confirm",
    ) as HTMLElement,
    /** Overwrite confirmation checkbox. */
    overwriteCheckbox: document.getElementById(
        "overwrite-checkbox",
    ) as HTMLInputElement,
    /** Loading overlay. */
    loadingOverlay: document.getElementById("loading-overlay") as HTMLElement,
};

/** Tracks whether the selected output file already exists. */
let outputFileExists = false;

/** Stores the BAM peek result for display in the summary. */
let bamPeekResult: PeekResult | null = null;

/** Stores the BED file line count for display in the summary. */
let bedLineCount: number | null = null;

/**
 * Creates a summary line element with a bold label and text value.
 *
 * @param label - The bold label text.
 * @param value - The value text displayed after the label.
 * @returns A paragraph element containing the label and value.
 */
function createSummaryLine(label: string, value: string): HTMLParagraphElement {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    return p;
}

/**
 * Updates the summary panel with the current BAM and BED file information.
 */
function updateSummary(): void {
    elements.fileSummary.textContent = "";

    let hasContent = false;

    if (bamPeekResult) {
        hasContent = true;
        const contigList = bamPeekResult.contigs.join(", ");
        const extra =
            bamPeekResult.totalContigs > bamPeekResult.contigs.length
                ? ` (+ ${bamPeekResult.totalContigs - bamPeekResult.contigs.length} more)`
                : "";
        elements.fileSummary.appendChild(
            createSummaryLine("Contigs", `${contigList}${extra}`),
        );

        const modText =
            bamPeekResult.modifications.length > 0
                ? bamPeekResult.modifications.join(", ")
                : "none detected";
        elements.fileSummary.appendChild(
            createSummaryLine("Modifications", modText),
        );
    }

    if (bedLineCount !== null) {
        hasContent = true;
        const suffix = bedLineCount !== 1 ? "s" : "";
        elements.fileSummary.appendChild(
            createSummaryLine(
                "BED file",
                `${bedLineCount.toLocaleString()} data line${suffix}`,
            ),
        );
    }

    if (!hasContent) {
        const placeholder = document.createElement("p");
        placeholder.className = "placeholder-text";
        placeholder.textContent = "Select files above to see a summary";
        elements.fileSummary.appendChild(placeholder);
    }
}

/**
 * Checks whether all three file paths are filled and enables/disables the start button.
 * Also blocks start when the output path matches the input BED path.
 */
function updateStartButton(): void {
    const allFilled =
        elements.bamPath.value.length > 0 &&
        elements.bedPath.value.length > 0 &&
        elements.outputPath.value.length > 0;

    const sameAsBed =
        allFilled && elements.outputPath.value === elements.bedPath.value;

    if (sameAsBed) {
        elements.fileExistsWarning.textContent =
            "Output path cannot be the same as the input BED file.";
        elements.fileExistsWarning.classList.remove("hidden");
        elements.overwriteConfirm.classList.add("hidden");
    } else if (outputFileExists) {
        elements.fileExistsWarning.textContent =
            "This file already exists and will be overwritten.";
        elements.fileExistsWarning.classList.remove("hidden");
        elements.overwriteConfirm.classList.remove("hidden");
    } else {
        elements.fileExistsWarning.classList.add("hidden");
        elements.overwriteConfirm.classList.add("hidden");
    }

    const overwriteOk = !outputFileExists || elements.overwriteCheckbox.checked;
    elements.btnStart.disabled = !allFilled || !overwriteOk || sameAsBed;
}

// Browse BAM
elements.btnBrowseBam.addEventListener("click", async () => {
    const path = await api.swipePickBam();
    if (!path) return;

    elements.bamPath.value = path;
    updateStartButton();

    // Peek at BAM for summary
    try {
        bamPeekResult = await api.peekBam(path, false);
    } catch (error) {
        console.error("Failed to peek BAM:", error);
        bamPeekResult = null;
    }
    if (path !== elements.bamPath.value) return;
    updateSummary();
});

// Browse BED
elements.btnBrowseBed.addEventListener("click", async () => {
    const path = await api.swipePickBed();
    if (!path) return;

    elements.bedPath.value = path;
    updateStartButton();

    // Count lines for summary
    try {
        bedLineCount = await api.swipeCountBedLines(path);
    } catch (error) {
        console.error("Failed to count BED lines:", error);
        bedLineCount = null;
    }
    if (path !== elements.bedPath.value) return;
    updateSummary();
});

// Browse output
elements.btnBrowseOutput.addEventListener("click", async () => {
    const path = await api.swipePickOutput();
    if (!path) return;

    elements.outputPath.value = path;
    elements.btnStart.disabled = true;

    // Check if output file exists and show overwrite confirmation if needed
    elements.overwriteCheckbox.checked = false;
    let exists = false;
    try {
        exists = await api.swipeCheckFileExists(path);
    } catch (error) {
        console.error("Failed to check file exists:", error);
    }
    if (path !== elements.outputPath.value) return;
    outputFileExists = exists;
    if (outputFileExists) {
        elements.fileExistsWarning.textContent =
            "This file already exists and will be overwritten.";
        elements.fileExistsWarning.classList.remove("hidden");
        elements.overwriteConfirm.classList.remove("hidden");
    } else {
        elements.fileExistsWarning.classList.add("hidden");
        elements.overwriteConfirm.classList.add("hidden");
    }
    updateStartButton();
});

// Overwrite confirmation checkbox
elements.overwriteCheckbox.addEventListener("change", () => {
    updateStartButton();
});

// Start swiping
elements.btnStart.addEventListener("click", async () => {
    const bamPath = elements.bamPath.value;
    const bedPath = elements.bedPath.value;
    const outputPath = elements.outputPath.value;

    if (!bamPath || !bedPath || !outputPath) return;

    elements.btnStart.disabled = true;
    elements.btnBack.disabled = true;
    elements.loadingOverlay.classList.remove("hidden");

    try {
        const result = await api.swipeStart(bamPath, bedPath, outputPath);
        if (!result.success) {
            elements.loadingOverlay.classList.add("hidden");
            elements.btnBack.disabled = false;
            updateStartButton();
            alert(
                `Failed to start swipe session: ${result.reason ?? "Unknown error"}`,
            );
        }
    } catch (error) {
        elements.loadingOverlay.classList.add("hidden");
        elements.btnBack.disabled = false;
        updateStartButton();
        alert(`Failed to start swipe session: ${String(error)}`);
    }
});

// Back button
elements.btnBack.addEventListener("click", () => {
    api.swipeGoBack();
});
