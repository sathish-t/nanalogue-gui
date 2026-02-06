// QC config page renderer

export {};

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

    /** Input field for the genomic region specification. */
    region: document.getElementById("region") as HTMLInputElement,

    /** Input field for the sampling fraction value. */
    sampleFraction: document.getElementById(
        "sample-fraction",
    ) as HTMLInputElement,

    /** Input field for the analysis window size. */
    windowSize: document.getElementById("window-size") as HTMLInputElement,

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
 * Loads and displays peek information from the specified BAM file or URL.
 *
 * @returns A promise that resolves when the peek information has been loaded and displayed.
 */
async function loadPeekInfo() {
    const bamPath = elements.bamPath.value.trim();
    if (!bamPath) return;

    elements.fileInfoContent.innerHTML =
        '<p class="loading-text">Loading...</p>';
    elements.btnGenerate.disabled = true;

    try {
        peekResult = await api.peekBam(bamPath, isUrl);

        const contigsText = peekResult.contigs.join(", ");
        const contigsSuffix =
            peekResult.totalContigs > 3
                ? `, ... (${peekResult.totalContigs} total)`
                : "";

        const modsText =
            peekResult.modifications.length > 0
                ? peekResult.modifications.join(", ")
                : "None detected";

        elements.fileInfoContent.innerHTML = `
      <p class="info-label">Header and first few records show:</p>
      <p><strong>Contigs:</strong> ${contigsText}${contigsSuffix}</p>
      <p><strong>Detected modifications:</strong> ${modsText}</p>
    `;

        elements.btnGenerate.disabled = false;
    } catch (error) {
        elements.fileInfoContent.innerHTML = `<p class="error-text">Error loading file: ${error}</p>`;
        peekResult = null;
    }
}

/**
 * Parses a modification filter string into a tag and strand direction.
 *
 * @param filter - The modification filter string, optionally prefixed with "+" or "-".
 * @returns An object containing the parsed tag and modification strand direction.
 */
function parseModFilter(filter: string): {
    /** The modification tag code extracted from the filter string. */
    tag?: string;
    /** The modification strand direction parsed from the sign prefix. */
    modStrand?: "bc" | "bc_comp";
} {
    const trimmed = filter.trim();
    if (!trimmed) return {};

    const match = trimmed.match(/^([+-])(.+)$/);
    if (!match) return { tag: trimmed };

    const [, sign, tag] = match;
    return {
        tag,
        modStrand: sign === "+" ? "bc" : "bc_comp",
    };
}

/**
 * Collects form values and triggers QC report generation via the API.
 *
 * @returns A promise that resolves when QC generation completes or an error is handled.
 */
async function generateQC() {
    const bamPath = elements.bamPath.value.trim();
    if (!bamPath) return;

    const { tag, modStrand } = parseModFilter(elements.modFilter.value);

    const config = {
        bamPath,
        treatAsUrl: isUrl,
        tag,
        modStrand,
        region: elements.region.value.trim() || undefined,
        sampleFraction: parseFloat(elements.sampleFraction.value),
        windowSize: parseInt(elements.windowSize.value, 10),
    };

    elements.loadingOverlay.classList.remove("hidden");

    try {
        await api.generateQC(config);
    } catch (error) {
        console.error("Error generating QC:", error);
        alert(`Error generating QC: ${error}`);
        elements.loadingOverlay.classList.add("hidden");
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
        elements.bamPath.value = "";
        elements.fileInfoContent.innerHTML =
            '<p class="placeholder-text">Will load upon BAM file specification</p>';
        elements.btnGenerate.disabled = true;
        peekResult = null;
    });
}

elements.btnGenerate.addEventListener("click", generateQC);

// Initialize
updateFileInputMode();
