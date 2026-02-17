// Locate reads configuration page renderer.
// Handles file selection, BAM peek, region validation, and BED generation.

import { formatContigLength } from "../../lib/format-utils";
import { parseRegion } from "../../lib/region-parser";
import type {
    BamResourceInput,
    BamSelectedDetail,
} from "../shared/bam-resource-input";
import "../shared/bam-resource-input";
import type { OutputFileInput } from "../shared/output-file-input";
import "../shared/output-file-input";

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
 * Summary of a locate-reads BED generation run.
 */
interface LocateResult {
    /** Total number of IDs in the read ID file. */
    totalIds: number;
    /** Number of IDs that matched records in the BAM. */
    found: number;
    /** Number of matched records that were unmapped. */
    unmapped: number;
    /** Number of BED entries written. */
    bedEntries: number;
    /** Number of IDs not found in the BAM. */
    notFound: number;
}

/**
 * Defines the preload API exposed to the locate config renderer.
 */
interface LocateConfigApi {
    /** Opens a native file dialog for selecting a BAM file. */
    locatePickBam: () => Promise<string | null>;
    /** Opens a native file dialog for selecting a read ID file. */
    locatePickReadIds: () => Promise<string | null>;
    /** Opens a native save dialog for selecting the output BED file path. */
    locatePickOutput: () => Promise<string | null>;
    /** Checks whether a file exists at the given path. */
    locateCheckFileExists: (filePath: string) => Promise<boolean>;
    /** Counts the number of non-empty lines in a read ID file. */
    locateCountReadIds: (filePath: string) => Promise<number>;
    /** Generates a BED file from read IDs found in a BAM file. */
    locateGenerateBed: (
        bamPath: string,
        readIdPath: string,
        outputPath: string,
        treatAsUrl: boolean,
        region?: string,
        fullRegion?: boolean,
    ) => Promise<LocateResult>;
    /** Peeks at a BAM file to extract header metadata. */
    peekBam: (bamPath: string, treatAsUrl: boolean) => Promise<PeekResult>;
    /** Navigates back to the landing page. */
    locateGoBack: () => Promise<void>;
}

/**
 * Preload-bridged API for communicating with the main process.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: LocateConfigApi;
    }
).api;

/**
 * BAM source custom element reference.
 */
const bamSource = document.getElementById("bam-source") as BamResourceInput;

/**
 * Output file custom element reference.
 */
const outputSource = document.getElementById(
    "output-source",
) as OutputFileInput;

/**
 * Cached references to DOM elements used throughout the config page.
 */
const elements = {
    /** Read ID file path input. */
    readIdPath: document.getElementById("read-id-path") as HTMLInputElement,
    /** Browse button for read ID file. */
    btnBrowseReadIds: document.getElementById(
        "btn-browse-read-ids",
    ) as HTMLButtonElement,
    /** Region input. */
    region: document.getElementById("region") as HTMLInputElement,
    /** Full-region checkbox. */
    fullRegion: document.getElementById("full-region") as HTMLInputElement,
    /** Generate BED file button. */
    btnGenerate: document.getElementById("btn-generate") as HTMLButtonElement,
    /** Back button. */
    btnBack: document.getElementById("btn-back") as HTMLButtonElement,
    /** File summary panel. */
    fileSummary: document.getElementById("file-summary") as HTMLElement,
    /** Loading overlay. */
    loadingOverlay: document.getElementById("loading-overlay") as HTMLElement,
    /** Results section. */
    resultsSection: document.getElementById("results-section") as HTMLElement,
    /** Results content area. */
    resultsContent: document.getElementById("results-content") as HTMLElement,
};

/** Stores the BAM peek result for display in the summary. */
let bamPeekResult: PeekResult | null = null;

/** Stores the read ID file line count for display in the summary. */
let readIdCount: number | null = null;

/** Monotonically increasing counter to guard against stale peek responses. */
let peekRequestId = 0;

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

    // Read ID count
    if (readIdCount !== null) {
        const readIdHeading = document.createElement("h3");
        readIdHeading.textContent = "Read ID file";
        content.appendChild(readIdHeading);

        const readIdP = document.createElement("p");
        const suffix = readIdCount !== 1 ? "s" : "";
        readIdP.textContent = `${readIdCount.toLocaleString()} read ID${suffix}`;
        content.appendChild(readIdP);
    }

    dialog.showModal();
}

/**
 * Updates the summary panel with the current BAM and read ID file information.
 */
function updateSummary(): void {
    elements.fileSummary.textContent = "";

    let hasContent = false;

    if (bamPeekResult) {
        hasContent = true;
        const sortedContigNames = Object.keys(
            bamPeekResult.allContigs ?? {},
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const contigList = sortedContigNames.slice(0, 3).join(", ");
        const extra =
            sortedContigNames.length > 3
                ? ` (+ ${sortedContigNames.length - 3} more)`
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

    if (readIdCount !== null) {
        hasContent = true;
        const suffix = readIdCount !== 1 ? "s" : "";
        elements.fileSummary.appendChild(
            createSummaryLine(
                "Read ID file",
                `${readIdCount.toLocaleString()} read ID${suffix}`,
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
 * Checks all inputs and enables/disables the generate button accordingly.
 */
function updateGenerateButton(): void {
    const bamValue = bamSource.value;
    const readIdValue = elements.readIdPath.value;
    const outputValue = outputSource.value;

    const allFilled =
        bamValue.length > 0 && readIdValue.length > 0 && outputValue.length > 0;

    // Check for path collisions (only local paths can collide)
    let hasCollision = false;
    if (allFilled) {
        const localBam = !bamSource.isUrl ? bamValue : null;
        if (localBam && localBam === readIdValue) {
            hasCollision = true;
        }
        if (localBam && localBam === outputValue) {
            hasCollision = true;
        }
        if (readIdValue === outputValue) {
            outputSource.showWarning(
                "Output path cannot be the same as the read ID file.",
                true,
            );
            hasCollision = true;
        } else if (outputSource.requiresOverwrite) {
            outputSource.showWarning(
                "This file already exists and will be overwritten.",
                false,
            );
        } else {
            outputSource.hideWarning();
        }
    }

    const overwriteOk =
        !outputSource.requiresOverwrite || outputSource.overwriteConfirmed;

    elements.btnGenerate.disabled = !allFilled || hasCollision || !overwriteOk;
}

// Wire BAM source

/**
 * Opens a native file dialog and returns the selected BAM path.
 *
 * @returns A promise resolving to the selected file path, or null if cancelled.
 */
bamSource.selectFileFn = () => api.locatePickBam();

/**
 * Opens a native save dialog and returns the selected output path.
 *
 * @returns A promise resolving to the selected file path, or null if cancelled.
 */
outputSource.selectFileFn = () => api.locatePickOutput();

/**
 * Checks whether a file already exists at the given path.
 *
 * @param p - The file path to check.
 * @returns A promise resolving to true if the file exists.
 */
outputSource.checkExistsFn = (p) => api.locateCheckFileExists(p);

// BAM selected
bamSource.addEventListener("bam-selected", async (e) => {
    const { value, isUrl } = (e as CustomEvent<BamSelectedDetail>).detail;
    if (!value.trim()) return;

    const currentRequestId = ++peekRequestId;
    updateGenerateButton();

    try {
        bamPeekResult = await api.peekBam(value, isUrl);
    } catch (error) {
        console.error("Failed to peek BAM:", error);
        bamPeekResult = null;
    }

    if (currentRequestId !== peekRequestId) return;
    if (value !== bamSource.value) return;

    updateSummary();
});

bamSource.addEventListener("source-type-changed", () => {
    peekRequestId++;
    bamPeekResult = null;
    updateGenerateButton();
    updateSummary();
});

// Browse read IDs
elements.btnBrowseReadIds.addEventListener("click", async () => {
    const path = await api.locatePickReadIds();
    if (!path) return;

    elements.readIdPath.value = path;
    updateGenerateButton();

    try {
        readIdCount = await api.locateCountReadIds(path);
    } catch (error) {
        console.error("Failed to count read IDs:", error);
        readIdCount = null;
    }
    if (path !== elements.readIdPath.value) return;
    updateSummary();
});

// Output file
outputSource.addEventListener("output-selected", () => updateGenerateButton());
outputSource.addEventListener("overwrite-confirmed", () =>
    updateGenerateButton(),
);

// Region input
elements.region.addEventListener("input", () => {
    const hasRegion = elements.region.value.trim().length > 0;
    elements.fullRegion.disabled = !hasRegion;
    if (!hasRegion) {
        elements.fullRegion.checked = false;
    }
});

// Generate BED
elements.btnGenerate.addEventListener("click", async () => {
    const bamPath = bamSource.value;
    const readIdPath = elements.readIdPath.value;
    const outputPath = outputSource.value;

    if (!bamPath || !readIdPath || !outputPath) return;

    // Validate region if provided
    const regionInput = elements.region.value.trim();
    if (regionInput && bamPeekResult?.allContigs) {
        const regionResult = parseRegion(regionInput, bamPeekResult.allContigs);
        if (!regionResult.valid) {
            alert(`Invalid region: ${regionResult.reason}`);
            return;
        }
    }

    const region = regionInput || undefined;
    const fullRegion = region ? elements.fullRegion.checked : undefined;
    const treatAsUrl = bamSource.isUrl;

    elements.btnGenerate.disabled = true;
    elements.btnBack.disabled = true;
    bamSource.disabled = true;
    elements.btnBrowseReadIds.disabled = true;
    outputSource.disabled = true;
    elements.loadingOverlay.classList.remove("hidden");

    try {
        const result = await api.locateGenerateBed(
            bamPath,
            readIdPath,
            outputPath,
            treatAsUrl,
            region,
            fullRegion,
        );

        elements.loadingOverlay.classList.add("hidden");
        showResults(result);
    } catch (error) {
        elements.loadingOverlay.classList.add("hidden");
        alert(`Error generating BED file: ${String(error)}`);
    } finally {
        elements.btnBack.disabled = false;
        bamSource.disabled = false;
        elements.btnBrowseReadIds.disabled = false;
        outputSource.disabled = false;
        updateGenerateButton();
    }
});

/**
 * Displays the generation results in the results section.
 *
 * @param result - The locate result summary from BED generation.
 */
function showResults(result: LocateResult): void {
    elements.resultsContent.textContent = "";

    const mainLine = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `Generated BED file with ${result.bedEntries.toLocaleString()} ${result.bedEntries !== 1 ? "entries" : "entry"}.`;
    mainLine.appendChild(strong);
    elements.resultsContent.appendChild(mainLine);

    if (result.notFound > 0 || result.unmapped > 0) {
        const detailLine = document.createElement("p");
        const parts: string[] = [];
        if (result.notFound > 0) {
            parts.push(
                `${result.notFound.toLocaleString()} read ID${result.notFound !== 1 ? "s" : ""} not found`,
            );
        }
        if (result.unmapped > 0) {
            parts.push(
                `${result.unmapped.toLocaleString()} unmapped (excluded)`,
            );
        }
        detailLine.textContent = `${parts.join(", ")}.`;
        elements.resultsContent.appendChild(detailLine);
    }

    const note = document.createElement("p");
    note.className = "results-note";
    note.textContent =
        "Note: If your read ID file has a header or comments, those lines " +
        'may appear in the "not found" count.';
    elements.resultsContent.appendChild(note);

    elements.resultsSection.classList.remove("hidden");
}

// Back button
elements.btnBack.addEventListener("click", () => {
    api.locateGoBack();
});

// Close button for the "More info" dialog
document.getElementById("more-info-close")?.addEventListener("click", () => {
    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    dialog?.close();
});
