// Swipe configuration page renderer

import { formatContigLength } from "../../lib/format-utils";
import { parseModFilter } from "../../lib/mod-filter";
import type { BamSelectedDetail } from "../shared/bam-resource-input";
import "../shared/bam-resource-input";

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
    /** Full contig-to-length mapping from the BAM header. */
    allContigs?: Record<string, number>;
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
        modTag?: string,
        modStrand?: "bc" | "bc_comp",
        flankingRegion?: number,
        showAnnotationHighlight?: boolean,
        treatAsUrl?: boolean,
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
 * BAM source custom element reference.
 */
const bamSource = document.getElementById(
    "bam-source",
) as import("../shared/bam-resource-input").BamResourceInput;

/**
 * Cached references to DOM elements used throughout the config page.
 */
const elements = {
    /** BED file path input. */
    bedPath: document.getElementById("bed-path") as HTMLInputElement,
    /** Output file path input. */
    outputPath: document.getElementById("output-path") as HTMLInputElement,
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
    /** Modification filter input. */
    modFilter: document.getElementById("mod-filter") as HTMLInputElement,
    /** Validation hint shown when mod filter is empty. */
    modFilterHint: document.getElementById("mod-filter-hint") as HTMLElement,
    /** Flanking region input. */
    flankingRegion: document.getElementById(
        "flanking-region",
    ) as HTMLInputElement,
    /** Annotation highlight checkbox. */
    showAnnotationHighlight: document.getElementById(
        "show-annotation-highlight",
    ) as HTMLInputElement,
    /** Annotation highlight section container. */
    annotationHighlightSection: document.getElementById(
        "annotation-highlight-section",
    ) as HTMLElement,
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
 * Opens the "More info" dialog showing full contig and modification details.
 */
function showMoreInfoDialog(): void {
    if (!bamPeekResult) return;

    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    const content = document.getElementById("more-info-content");
    if (!dialog || !content) return;
    if (dialog.open) return;

    content.textContent = "";

    // Contigs table
    const contigHeading = document.createElement("h3");
    contigHeading.textContent = `Contigs (${bamPeekResult.totalContigs})`;
    content.appendChild(contigHeading);

    const table = document.createElement("table");
    table.className = "more-info-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const nameHeader = document.createElement("th");
    nameHeader.textContent = "Name";
    const lengthHeader = document.createElement("th");
    lengthHeader.textContent = "Length";
    headerRow.append(nameHeader, lengthHeader);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const sortedContigs = Object.entries(bamPeekResult.allContigs ?? {}).sort(
        (a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
    for (const [name, length] of sortedContigs) {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        nameCell.textContent = name;
        const lengthCell = document.createElement("td");
        lengthCell.textContent = formatContigLength(length);
        row.append(nameCell, lengthCell);
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    content.appendChild(table);

    // Modifications list
    const modsHeading = document.createElement("h3");
    modsHeading.textContent = "Detected modifications";
    content.appendChild(modsHeading);

    if (bamPeekResult.modifications.length === 0) {
        const noneP = document.createElement("p");
        noneP.className = "placeholder-text";
        noneP.textContent = "None detected";
        content.appendChild(noneP);
    } else {
        const modsList = document.createElement("ul");
        modsList.className = "more-info-list";
        for (const mod of bamPeekResult.modifications) {
            const li = document.createElement("li");
            li.textContent = mod;
            modsList.appendChild(li);
        }
        content.appendChild(modsList);
    }

    // BED line count
    if (bedLineCount !== null) {
        const bedHeading = document.createElement("h3");
        bedHeading.textContent = "BED annotations";
        content.appendChild(bedHeading);

        const bedP = document.createElement("p");
        const suffix = bedLineCount !== 1 ? "s" : "";
        bedP.textContent = `${bedLineCount.toLocaleString()} data line${suffix}`;
        content.appendChild(bedP);
    }

    const strandNote = document.createElement("p");
    strandNote.className = "more-info-note";
    strandNote.textContent =
        "+ means mods are on the basecalled strand, - means they are on the " +
        "complementary strand. Some technologies like PacBio and ONT duplex " +
        "may report mods on two strands, so you may see both + and - in the " +
        "mods found. Other technologies just report data on the sequenced " +
        "strand, so in this case you will just see a + in the mods found.";
    content.appendChild(strandNote);

    dialog.showModal();
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

    if (bamPeekResult) {
        const moreInfoBtn = document.createElement("button");
        moreInfoBtn.type = "button";
        moreInfoBtn.id = "btn-more-info";
        moreInfoBtn.className = "small-button";
        moreInfoBtn.textContent = "More info";
        moreInfoBtn.addEventListener("click", () => showMoreInfoDialog());
        elements.fileSummary.appendChild(moreInfoBtn);
    }

    if (!hasContent) {
        const placeholder = document.createElement("p");
        placeholder.className = "placeholder-text";
        placeholder.textContent = "Select files above to see a summary";
        elements.fileSummary.appendChild(placeholder);
    }
}

/**
 * Checks whether all three file paths are filled and enables/disables the start button and dependent fields.
 * Also blocks start when the output path matches the input BED path or when the mod filter is empty.
 */
function updateStartButton(): void {
    const allFilled =
        bamSource.value.length > 0 &&
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
    const modFilterValid = Boolean(
        parseModFilter(elements.modFilter.value).tag,
    );

    // Enable flanking region when all paths are valid
    elements.flankingRegion.disabled = !(
        allFilled &&
        overwriteOk &&
        !sameAsBed
    );

    // Enable annotation highlight when all conditions for starting are met
    const canStart = allFilled && overwriteOk && !sameAsBed;
    elements.showAnnotationHighlight.disabled = !canStart;
    elements.showAnnotationHighlight.parentElement?.classList.toggle(
        "is-disabled",
        !canStart,
    );

    // Show validation hint when mod filter is invalid and other conditions are met
    if (allFilled && overwriteOk && !sameAsBed && !modFilterValid) {
        const trimmed = elements.modFilter.value.trim();
        elements.modFilterHint.textContent =
            trimmed.length > 0
                ? "Invalid format \u2014 use +TAG or -TAG (e.g. +T, -m)"
                : "Required \u2014 enter a modification tag to proceed";
        elements.modFilterHint.classList.remove("hidden");
    } else {
        elements.modFilterHint.classList.add("hidden");
    }

    elements.btnStart.disabled =
        !allFilled || !overwriteOk || sameAsBed || !modFilterValid;
}

// Wire the BAM source element to the file picker API

/**
 * Opens a native file dialog and returns the selected BAM path.
 *
 * @returns A promise resolving to the selected file path, or null if cancelled.
 */
bamSource.selectFileFn = () => api.swipePickBam();

bamSource.addEventListener("bam-selected", async (e) => {
    const { value, isUrl } = (e as CustomEvent<BamSelectedDetail>).detail;
    if (!value.trim()) return;

    updateStartButton();

    // Peek at BAM for summary
    try {
        bamPeekResult = await api.peekBam(value, isUrl);
    } catch (error) {
        console.error("Failed to peek BAM:", error);
        bamPeekResult = null;
    }
    if (value !== bamSource.value) return;

    // Auto-populate mod filter with first detected modification
    if (
        bamPeekResult &&
        bamPeekResult.modifications.length > 0 &&
        !parseModFilter(elements.modFilter.value).tag
    ) {
        elements.modFilter.value = bamPeekResult.modifications[0];
        updateStartButton();
    }

    updateSummary();
});

bamSource.addEventListener("source-type-changed", () => {
    bamPeekResult = null;
    updateStartButton();
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

// Modification filter input
elements.modFilter.addEventListener("input", () => {
    updateStartButton();
});

// Start swiping
elements.btnStart.addEventListener("click", async () => {
    const bamPath = bamSource.value;
    const bedPath = elements.bedPath.value;
    const outputPath = elements.outputPath.value;

    if (!bamPath || !bedPath || !outputPath) return;

    const { tag: modTag, modStrand } = parseModFilter(elements.modFilter.value);
    const rawFlanking = Number(elements.flankingRegion.value);
    if (!Number.isInteger(rawFlanking) || rawFlanking < 0) {
        alert("Flanking region must be a non-negative integer.");
        elements.btnStart.disabled = false;
        return;
    }
    const flankingRegion = rawFlanking;
    const showAnnotationHighlight = elements.showAnnotationHighlight.checked;
    const treatAsUrl = bamSource.isUrl;

    elements.btnStart.disabled = true;
    elements.btnBack.disabled = true;
    elements.loadingOverlay.classList.remove("hidden");

    try {
        const result = await api.swipeStart(
            bamPath,
            bedPath,
            outputPath,
            modTag,
            modStrand,
            flankingRegion,
            showAnnotationHighlight,
            treatAsUrl,
        );
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

// Close button for the "More info" dialog
document.getElementById("more-info-close")?.addEventListener("click", () => {
    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    dialog?.close();
});
