// QC config page renderer

import { formatContigLength } from "../../lib/format-utils";
import { parseModFilter } from "../../lib/mod-filter";
import { parseRegion } from "../../lib/region-parser";

/**
 * Result returned from peeking into a BAM file header and first records.
 */
interface PeekResult {
    /** List of contig names found in the BAM header. */
    contigs: string[];

    /** Total number of contigs present in the BAM file. */
    totalContigs: number;

    /** List of base modification types detected in the BAM records. */
    modifications: string[];

    /** Full contig-to-length mapping from the BAM header. */
    allContigs?: Record<string, number>;
}

/**
 * API surface exposed to the QC config renderer via the preload bridge.
 */
interface QCApi {
    /** Peeks into a BAM file or URL and returns contig and modification information. */
    peekBam: (bamPath: string, treatAsUrl: boolean) => Promise<PeekResult>;

    /** Generates a QC report from the given configuration options. */
    generateQC: (options: Record<string, unknown>) => Promise<void>;

    /** Opens a native file dialog and returns the selected file path, or null if cancelled. */
    selectFile: () => Promise<string | null>;

    /** Navigates back to the previous page. */
    goBack: () => Promise<void>;
}

/**
 * Preload-bridged API for QC configuration operations.
 */
const api = (
    window as unknown as {
        /** The preload-exposed API object. */
        api: QCApi;
    }
).api;

/**
 * Collection of DOM element references used by the QC config form.
 */
const elements = {
    /** Button that navigates back to the previous page. */
    btnBack: document.getElementById("btn-back") as HTMLButtonElement,

    /** Button that opens the native file browser dialog. */
    btnBrowse: document.getElementById("btn-browse") as HTMLButtonElement,

    /** Button that triggers QC report generation. */
    btnGenerate: document.getElementById("btn-generate") as HTMLButtonElement,

    /** Input field for the BAM file path or URL. */
    bamPath: document.getElementById("bam-path") as HTMLInputElement,

    /** Container element that displays BAM file peek information. */
    fileInfoContent: document.getElementById(
        "file-info-content",
    ) as HTMLElement,

    /** Input field for the modification type filter string. */
    modFilter: document.getElementById("mod-filter") as HTMLInputElement,

    /** Validation hint shown when mod filter is empty or invalid. */
    modFilterHint: document.getElementById("mod-filter-hint") as HTMLElement,

    /** Input field for the genomic region specification. */
    region: document.getElementById("region") as HTMLInputElement,

    /** Input field for the sampling fraction value. */
    sampleFraction: document.getElementById(
        "sample-fraction",
    ) as HTMLInputElement,

    /** Input field for the analysis window size. */
    windowSize: document.getElementById("window-size") as HTMLInputElement,

    /** Dropdown for read length histogram granularity. */
    readLengthGranularity: document.getElementById(
        "read-length-granularity",
    ) as HTMLSelectElement,

    /** Overlay element shown while QC generation is in progress. */
    loadingOverlay: document.getElementById("loading-overlay") as HTMLElement,

    /** Radio button group for selecting between file and URL source types. */
    sourceTypeRadios: Array.from(
        document.querySelectorAll('input[name="source-type"]'),
    ) as HTMLInputElement[],
};

/** Tracks whether the current source type is a URL. */
let isUrl = false;

/** Stores the most recent BAM peek result, or null if none has been loaded. */
let peekResult: PeekResult | null = null;

/** Monotonically increasing counter to guard against stale peek responses. */
let peekRequestId = 0;

/**
 * Reads the currently selected source type from the radio button group.
 *
 * @returns The selected source type, either "file" or "url".
 */
function getSourceType(): "file" | "url" {
    for (const radio of elements.sourceTypeRadios) {
        if (radio.checked) return radio.value as "file" | "url";
    }
    return "file";
}

/**
 * Updates the file input mode based on the selected source type.
 */
function updateFileInputMode() {
    isUrl = getSourceType() === "url";
    elements.bamPath.readOnly = !isUrl;
    elements.btnBrowse.style.display = isUrl ? "none" : "block";
    elements.bamPath.placeholder = isUrl ? "Enter BAM URL" : "Select BAM file";
}

/**
 * Enables or disables the Generate button based on whether a BAM is loaded and the mod filter is valid.
 */
function updateGenerateButton(): void {
    const bamLoaded = peekResult !== null;
    const modFilterValid = Boolean(
        parseModFilter(elements.modFilter.value).tag,
    );
    elements.btnGenerate.disabled = !bamLoaded || !modFilterValid;

    if (bamLoaded && !modFilterValid) {
        const trimmed = elements.modFilter.value.trim();
        elements.modFilterHint.textContent =
            trimmed.length > 0
                ? "Invalid format \u2014 use +TAG or -TAG (e.g. +T, -m)"
                : "Required \u2014 enter a modification tag to proceed";
        elements.modFilterHint.classList.remove("hidden");
    } else {
        elements.modFilterHint.classList.add("hidden");
    }
}

/**
 * Loads and displays peek information from the specified BAM file or URL.
 *
 * @returns A promise that resolves when the peek information has been loaded and displayed.
 */
async function loadPeekInfo() {
    const bamPath = elements.bamPath.value.trim();
    if (!bamPath) return;

    const currentRequestId = ++peekRequestId;

    elements.fileInfoContent.innerHTML =
        '<p class="loading-text">Loading...</p>';
    elements.btnGenerate.disabled = true;
    elements.bamPath.disabled = true;
    elements.btnBrowse.disabled = true;

    try {
        const result = await api.peekBam(bamPath, isUrl);

        // Discard stale response if a newer request was issued
        if (currentRequestId !== peekRequestId) return;

        peekResult = result;

        // Auto-populate mod filter with first detected modification
        if (
            peekResult.modifications.length > 0 &&
            !parseModFilter(elements.modFilter.value).tag
        ) {
            elements.modFilter.value = peekResult.modifications[0];
        }

        const contigsText = peekResult.contigs.join(", ");
        const contigsSuffix =
            peekResult.totalContigs > 3
                ? `, ... (${peekResult.totalContigs} total)`
                : "";

        const modsText =
            peekResult.modifications.length > 0
                ? peekResult.modifications.join(", ")
                : "None detected";

        elements.fileInfoContent.textContent = "";

        const infoLabel = document.createElement("p");
        infoLabel.className = "info-label";
        infoLabel.textContent = "Header and first few records show:";

        const contigsP = document.createElement("p");
        const contigsStrong = document.createElement("strong");
        contigsStrong.textContent = "Contigs: ";
        contigsP.appendChild(contigsStrong);
        contigsP.appendChild(
            document.createTextNode(`${contigsText}${contigsSuffix}`),
        );

        const modsP = document.createElement("p");
        const modsStrong = document.createElement("strong");
        modsStrong.textContent = "Detected modifications: ";
        modsP.appendChild(modsStrong);
        modsP.appendChild(document.createTextNode(modsText));

        const moreInfoBtn = document.createElement("button");
        moreInfoBtn.type = "button";
        moreInfoBtn.id = "btn-more-info";
        moreInfoBtn.className = "small-button";
        moreInfoBtn.textContent = "More info";
        moreInfoBtn.addEventListener("click", () => showMoreInfoDialog());

        elements.fileInfoContent.append(
            infoLabel,
            contigsP,
            modsP,
            moreInfoBtn,
        );

        updateGenerateButton();
    } catch (error) {
        // Discard stale error if a newer request was issued
        if (currentRequestId !== peekRequestId) return;

        elements.fileInfoContent.textContent = "";
        const errorP = document.createElement("p");
        errorP.className = "error-text";
        errorP.textContent = `Error loading file: ${String(error)}`;
        elements.fileInfoContent.appendChild(errorP);
        peekResult = null;
    } finally {
        // Only re-enable input if this is still the latest request
        if (currentRequestId === peekRequestId) {
            elements.bamPath.disabled = false;
            elements.btnBrowse.disabled = false;
        }
    }
}

/**
 * Opens the "More info" dialog showing full contig and modification details.
 */
function showMoreInfoDialog(): void {
    if (!peekResult) return;

    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    const content = document.getElementById("more-info-content");
    if (!dialog || !content) return;
    if (dialog.open) return;

    content.textContent = "";

    // Contigs table
    const contigHeading = document.createElement("h3");
    contigHeading.textContent = `Contigs (${peekResult.totalContigs})`;
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
    const sortedContigs = Object.entries(peekResult.allContigs ?? {}).sort(
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

    if (peekResult.modifications.length === 0) {
        const noneP = document.createElement("p");
        noneP.className = "placeholder-text";
        noneP.textContent = "None detected";
        content.appendChild(noneP);
    } else {
        const modsList = document.createElement("ul");
        modsList.className = "more-info-list";
        for (const mod of peekResult.modifications) {
            const li = document.createElement("li");
            li.textContent = mod;
            modsList.appendChild(li);
        }
        content.appendChild(modsList);
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
 * Collects form values and triggers QC report generation via the API.
 *
 * @returns A promise that resolves when QC generation completes or an error is handled.
 */
async function generateQC() {
    const bamPath = elements.bamPath.value.trim();
    if (!bamPath) return;

    elements.btnGenerate.disabled = true;

    const { tag, modStrand } = parseModFilter(elements.modFilter.value);
    if (!tag) {
        updateGenerateButton();
        return;
    }

    const sampleFraction = parseFloat(elements.sampleFraction.value);
    const windowSize = parseInt(elements.windowSize.value, 10);

    if (
        Number.isNaN(sampleFraction) ||
        sampleFraction < 0.01 ||
        sampleFraction > 100
    ) {
        alert("Sample fraction must be a number between 0.01 and 100.");
        elements.btnGenerate.disabled = false;
        return;
    }

    if (Number.isNaN(windowSize) || windowSize < 1) {
        alert("Window size must be a number of at least 1.");
        elements.btnGenerate.disabled = false;
        return;
    }

    const readLengthBinWidth = parseInt(
        elements.readLengthGranularity.value,
        10,
    );

    if (
        !Number.isFinite(readLengthBinWidth) ||
        readLengthBinWidth < 1 ||
        readLengthBinWidth !== Math.floor(readLengthBinWidth)
    ) {
        alert("Read length granularity must be a positive integer.");
        elements.btnGenerate.disabled = false;
        return;
    }

    const regionInput = elements.region.value.trim();
    if (regionInput && peekResult?.allContigs) {
        const regionResult = parseRegion(regionInput, peekResult.allContigs);
        if (!regionResult.valid) {
            alert(`Invalid region: ${regionResult.reason}`);
            elements.btnGenerate.disabled = false;
            return;
        }
    }

    const config = {
        bamPath,
        treatAsUrl: isUrl,
        tag,
        modStrand,
        region: regionInput || undefined,
        sampleFraction,
        windowSize,
        readLengthBinWidth,
    };

    elements.loadingOverlay.classList.remove("hidden");

    try {
        await api.generateQC(config);
    } catch (error) {
        console.error("Error generating QC:", error);
        alert(`Error generating QC: ${error}`);
        elements.loadingOverlay.classList.add("hidden");
        elements.btnGenerate.disabled = false;
    }
}

// Event listeners
elements.btnBack.addEventListener("click", () => api.goBack());

elements.btnBrowse.addEventListener("click", async () => {
    const path = await api.selectFile();
    if (path) {
        elements.bamPath.value = path;
        await loadPeekInfo();
    }
});

elements.bamPath.addEventListener("change", async () => {
    if (isUrl && elements.bamPath.value.trim()) {
        await loadPeekInfo();
    }
});

elements.bamPath.addEventListener("keypress", async (e) => {
    if (e.key === "Enter" && isUrl) {
        await loadPeekInfo();
    }
});

for (const radio of elements.sourceTypeRadios) {
    radio.addEventListener("change", () => {
        updateFileInputMode();
        peekRequestId++;
        elements.bamPath.disabled = false;
        elements.btnBrowse.disabled = false;
        elements.bamPath.value = "";
        elements.fileInfoContent.innerHTML =
            '<p class="placeholder-text">Will load upon BAM file specification</p>';
        elements.btnGenerate.disabled = true;
        peekResult = null;
    });
}

elements.modFilter.addEventListener("input", () => {
    updateGenerateButton();
});

elements.btnGenerate.addEventListener("click", generateQC);

// Close button for the "More info" dialog
document.getElementById("more-info-close")?.addEventListener("click", () => {
    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    dialog?.close();
});

// Initialize
updateFileInputMode();
