// QC config page renderer

import { formatContigLength } from "../../lib/format-utils";
import { parseRegion, validateModRegionOverlap } from "../../lib/region-parser";
import type { BamSelectedDetail } from "../shared/bam-resource-input";
import "../shared/bam-resource-input";
import type { ModFilterInput } from "../shared/mod-filter-input";
import "../shared/mod-filter-input";

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

    /** Opens a native file dialog for selecting a read ID text file. Reuses locate mode handler. */
    locatePickReadIds: () => Promise<string | null>;

    /** Counts non-empty lines in the specified read ID file. */
    locateCountReadIds: (filePath: string) => Promise<number>;
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
 * BAM source custom element reference.
 */
const bamSource = document.getElementById(
    "bam-source",
) as import("../shared/bam-resource-input").BamResourceInput;

/**
 * Modification filter custom element reference.
 */
const modFilter = document.getElementById("mod-filter") as ModFilterInput;

/**
 * Collection of DOM element references used by the QC config form.
 */
const elements = {
    /** Button that navigates back to the previous page. */
    btnBack: document.getElementById("btn-back") as HTMLButtonElement,

    /** Button that triggers QC report generation. */
    btnGenerate: document.getElementById("btn-generate") as HTMLButtonElement,

    /** Container element that displays BAM file peek information. */
    fileInfoContent: document.getElementById(
        "file-info-content",
    ) as HTMLElement,

    /** Input field for the genomic region specification. */
    region: document.getElementById("region") as HTMLInputElement,

    /** Checkbox to restrict to reads that fully span the region. */
    fullRegion: document.getElementById("full-region") as HTMLInputElement,

    /** Input field for the optional modification sub-region. */
    modRegion: document.getElementById("mod-region") as HTMLInputElement,

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

    /** Sample seed input for reproducible subsampling. */
    sampleSeed: document.getElementById("sample-seed") as HTMLInputElement,

    /** MAPQ filter number input. */
    mapqFilter: document.getElementById("mapq-filter") as HTMLInputElement,

    /** Checkbox to exclude reads with unavailable MAPQ. */
    excludeMapqUnavail: document.getElementById(
        "exclude-mapq-unavail",
    ) as HTMLInputElement,

    /** Read ID file path display input. */
    readIdPath: document.getElementById("read-id-path") as HTMLInputElement,

    /** Button to browse for a read ID file. */
    btnBrowseReadIds: document.getElementById(
        "btn-browse-read-ids",
    ) as HTMLButtonElement,

    /** Button to clear the selected read ID file. */
    btnClearReadIds: document.getElementById(
        "btn-clear-read-ids",
    ) as HTMLButtonElement,

    /** Text element showing the read ID count. */
    readIdCount: document.getElementById("read-id-count") as HTMLElement,

    /** Min sequence length input. */
    minSeqLen: document.getElementById("min-seq-len") as HTMLInputElement,

    /** Min alignment length input. */
    minAlignLen: document.getElementById("min-align-len") as HTMLInputElement,

    /** Base quality filter for mods input. */
    baseQualFilterMod: document.getElementById(
        "base-qual-filter-mod",
    ) as HTMLInputElement,

    /** Trim read ends for mods input. */
    trimReadEndsMod: document.getElementById(
        "trim-read-ends-mod",
    ) as HTMLInputElement,

    /** Low bound for mod probability rejection. */
    modProbLow: document.getElementById("mod-prob-low") as HTMLInputElement,

    /** High bound for mod probability rejection. */
    modProbHigh: document.getElementById("mod-prob-high") as HTMLInputElement,
};

// Populate the sample seed input with a random default value.
elements.sampleSeed.value = String(Math.floor(Math.random() * 2 ** 32));

/** Stores the most recent BAM peek result, or null if none has been loaded. */
let peekResult: PeekResult | null = null;

/** Monotonically increasing counter to guard against stale peek responses. */
let peekRequestId = 0;

/**
 * Enables or disables the Generate button based on whether a BAM is loaded and the mod filter is valid.
 */
function updateGenerateButton(): void {
    const bamLoaded = peekResult !== null;
    modFilter.showValidation = bamLoaded;
    elements.btnGenerate.disabled = !bamLoaded || !modFilter.isValid;
}

/**
 * Loads and displays peek information from the specified BAM file or URL.
 *
 * @returns A promise that resolves when the peek information has been loaded and displayed.
 */
async function loadPeekInfo() {
    const bamPath = bamSource.value.trim();
    if (!bamPath) return;

    const currentRequestId = ++peekRequestId;

    elements.fileInfoContent.innerHTML =
        '<p class="loading-text">Loading...</p>';
    elements.btnGenerate.disabled = true;
    bamSource.disabled = true;

    try {
        const result = await api.peekBam(bamPath, bamSource.isUrl);

        // Discard stale response if a newer request was issued
        if (currentRequestId !== peekRequestId) return;

        peekResult = result;

        // Auto-populate mod filter with first detected modification
        modFilter.autoPopulate(peekResult.modifications);

        const sortedContigNames = Object.keys(peekResult.allContigs ?? {}).sort(
            (a, b) => a.localeCompare(b, undefined, { numeric: true }),
        );
        const contigsText = sortedContigNames.slice(0, 3).join(", ");
        const contigsSuffix =
            sortedContigNames.length > 3
                ? `, ... (${sortedContigNames.length} total)`
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
            bamSource.disabled = false;
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
 * Collects checked alignment type values from the read filter checkboxes.
 *
 * @returns A comma-separated string of selected alignment types, or undefined if none are checked.
 */
function getReadFilter(): string | undefined {
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
        ".read-filter-checkboxes input[type='checkbox']:checked",
    );
    if (checkboxes.length === 0) return undefined;
    return Array.from(checkboxes)
        .map((cb) => cb.value)
        .join(",");
}

/**
 * Parses a number input value, returning undefined if empty or NaN.
 *
 * @param input - The HTML input element to read from.
 * @returns The parsed number, or undefined if the input is empty or invalid.
 */
function parseOptionalNumber(input: HTMLInputElement): number | undefined {
    const val = input.value.trim();
    if (val === "") return undefined;
    const num = Number(val);
    return Number.isFinite(num) ? num : undefined;
}

/**
 * Collects form values and triggers QC report generation via the API.
 *
 * @returns A promise that resolves when QC generation completes or an error is handled.
 */
async function generateQC() {
    const bamPath = bamSource.value.trim();
    if (!bamPath) return;

    elements.btnGenerate.disabled = true;

    const { tag, modStrand } = modFilter;
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

    const sampleSeed = parseInt(elements.sampleSeed.value, 10);
    if (Number.isNaN(sampleSeed) || sampleSeed < 0) {
        alert("Sample seed must be a non-negative integer.");
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

    const modRegionInput = elements.modRegion.value.trim();
    let modRegionStr: string | undefined;
    if (modRegionInput) {
        if (!regionInput) {
            alert("Mod region requires a region to be set.");
            elements.btnGenerate.disabled = false;
            return;
        }
        if (peekResult?.allContigs) {
            const modRegionResult = parseRegion(
                modRegionInput,
                peekResult.allContigs,
            );
            if (!modRegionResult.valid) {
                alert(`Invalid mod region: ${modRegionResult.reason}`);
                elements.btnGenerate.disabled = false;
                return;
            }
            const regionResult = parseRegion(
                regionInput,
                peekResult.allContigs,
            );
            if (regionResult.valid) {
                const overlapError = validateModRegionOverlap(
                    regionResult,
                    modRegionResult,
                );
                if (overlapError) {
                    alert(overlapError);
                    elements.btnGenerate.disabled = false;
                    return;
                }
            }
        }
        modRegionStr = modRegionInput;
    }

    const region = regionInput || undefined;

    const mapqFilter = parseOptionalNumber(elements.mapqFilter);
    const excludeMapqUnavail = elements.excludeMapqUnavail.checked || undefined;
    const readFilter = getReadFilter();
    const minSeqLen = parseOptionalNumber(elements.minSeqLen);
    const minAlignLen = parseOptionalNumber(elements.minAlignLen);
    const readIdFilePath = elements.readIdPath.value.trim() || undefined;
    const baseQualFilterMod = parseOptionalNumber(elements.baseQualFilterMod);
    const trimReadEndsMod = parseOptionalNumber(elements.trimReadEndsMod);

    const probLow = parseOptionalNumber(elements.modProbLow);
    const probHigh = parseOptionalNumber(elements.modProbHigh);
    const hasLow = probLow !== undefined;
    const hasHigh = probHigh !== undefined;

    if (hasLow !== hasHigh) {
        alert("Mod probability filter requires both low and high bounds.");
        elements.btnGenerate.disabled = false;
        return;
    }

    if (hasLow && hasHigh && probLow >= probHigh) {
        alert(
            "Mod probability filter: low bound must be less than high bound.",
        );
        elements.btnGenerate.disabled = false;
        return;
    }

    const rejectModQualNonInclusive =
        hasLow && hasHigh
            ? ([probLow, probHigh] as [number, number])
            : undefined;

    const config = {
        bamPath,
        treatAsUrl: bamSource.isUrl,
        tag,
        modStrand,
        region,
        modRegion: modRegionStr,
        fullRegion: region ? elements.fullRegion.checked : undefined,
        sampleFraction,
        sampleSeed,
        windowSize,
        readLengthBinWidth,
        mapqFilter,
        excludeMapqUnavail,
        readFilter,
        minSeqLen,
        minAlignLen,
        readIdFilePath,
        baseQualFilterMod,
        trimReadEndsMod,
        rejectModQualNonInclusive,
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

// Wire the BAM source element to the file picker API

/**
 * Opens a native file dialog and returns the selected path.
 *
 * @returns A promise resolving to the selected file path, or null if cancelled.
 */
bamSource.selectFileFn = () => api.selectFile();

bamSource.addEventListener("bam-selected", async (e) => {
    const { value } = (e as CustomEvent<BamSelectedDetail>).detail;
    if (value.trim()) {
        await loadPeekInfo();
    }
});

bamSource.addEventListener("source-type-changed", () => {
    peekRequestId++;
    bamSource.disabled = false;
    elements.fileInfoContent.innerHTML =
        '<p class="placeholder-text">Will load upon BAM file specification</p>';
    elements.btnGenerate.disabled = true;
    peekResult = null;
});

modFilter.addEventListener("mod-filter-changed", () => {
    updateGenerateButton();
});

elements.region.addEventListener("input", () => {
    const hasRegion = elements.region.value.trim().length > 0;
    elements.fullRegion.disabled = !hasRegion;
    if (!hasRegion) {
        elements.fullRegion.checked = false;
    }
});

elements.btnGenerate.addEventListener("click", generateQC);

elements.btnBrowseReadIds.addEventListener("click", async () => {
    const path = await api.locatePickReadIds();
    if (!path) return;

    elements.readIdPath.value = path;
    elements.btnClearReadIds.classList.remove("hidden");

    try {
        const count = await api.locateCountReadIds(path);
        // Guard against stale responses from a previous or cleared selection.
        if (elements.readIdPath.value !== path) return;
        elements.readIdCount.textContent = `${count.toLocaleString()} read IDs found`;
    } catch (error) {
        if (elements.readIdPath.value !== path) return;
        console.error("Failed to count read IDs:", error);
        elements.readIdCount.textContent = "Error reading file";
    }
});

elements.btnClearReadIds.addEventListener("click", () => {
    elements.readIdPath.value = "";
    elements.readIdCount.textContent = "";
    elements.btnClearReadIds.classList.add("hidden");
});

// Close button for the "More info" dialog
document.getElementById("more-info-close")?.addEventListener("click", () => {
    const dialog = document.getElementById(
        "more-info-dialog",
    ) as HTMLDialogElement | null;
    dialog?.close();
});
