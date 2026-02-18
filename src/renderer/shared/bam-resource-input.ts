// Reusable custom element for BAM file/URL source selection
// Renders a radio toggle (file vs URL) and a text input with optional Browse button

/** Monotonically increasing counter to generate unique radio group names. */
let instanceCounter = 0;

/**
 * Detail payload for the "bam-selected" custom event.
 */
export interface BamSelectedDetail {
    /** The selected BAM path or URL. */
    value: string;
    /** Whether the value is a URL rather than a local file path. */
    isUrl: boolean;
}

/**
 * Custom element providing a BAM source input with file/URL radio toggle.
 *
 * Renders a source-toggle radio group and a file-input-row with a text input
 * and Browse button. In file mode the input is readonly and Browse is visible;
 * in URL mode the input is editable and Browse is hidden.
 *
 * Fires "bam-selected" when a file is chosen or a URL is confirmed, and
 * "source-type-changed" when the user switches between file and URL mode.
 */
export class BamResourceInput extends HTMLElement {
    /** Radio button for selecting local file mode. */
    private fileRadio!: HTMLInputElement;

    /** Radio button for selecting URL mode. */
    private urlRadio!: HTMLInputElement;

    /** Text input for the BAM path or URL. */
    private textInput!: HTMLInputElement;

    /** Browse button for opening a native file dialog. */
    private browseBtn!: HTMLButtonElement;

    /** Pluggable callback invoked when the Browse button is clicked. */
    selectFileFn: (() => Promise<string | null>) | null = null;

    /** Whether the DOM has already been built by a previous connectedCallback. */
    private initialized = false;

    /**
     * Builds the element's light-DOM content on first connection.
     */
    connectedCallback(): void {
        if (this.initialized) return;
        this.initialized = true;

        const id = instanceCounter++;

        // Source toggle radios
        const toggle = document.createElement("div");
        toggle.className = "source-toggle";

        const fileLabel = document.createElement("label");
        this.fileRadio = document.createElement("input");
        this.fileRadio.type = "radio";
        this.fileRadio.name = `source-type-${id}`;
        this.fileRadio.value = "file";
        this.fileRadio.checked = true;
        fileLabel.appendChild(this.fileRadio);
        fileLabel.appendChild(document.createTextNode(" Local file"));
        toggle.appendChild(fileLabel);

        const urlLabel = document.createElement("label");
        this.urlRadio = document.createElement("input");
        this.urlRadio.type = "radio";
        this.urlRadio.name = `source-type-${id}`;
        this.urlRadio.value = "url";
        urlLabel.appendChild(this.urlRadio);
        urlLabel.appendChild(document.createTextNode(" URL"));
        toggle.appendChild(urlLabel);

        // File input row
        const row = document.createElement("div");
        row.className = "file-input-row";

        const hiddenLabel = document.createElement("label");
        hiddenLabel.className = "visually-hidden";
        hiddenLabel.textContent = "BAM path";
        row.appendChild(hiddenLabel);

        this.textInput = document.createElement("input");
        this.textInput.type = "text";
        this.textInput.placeholder = "Select BAM/CRAM file";
        this.textInput.readOnly = true;
        row.appendChild(this.textInput);

        this.browseBtn = document.createElement("button");
        this.browseBtn.type = "button";
        this.browseBtn.textContent = "Browse";
        row.appendChild(this.browseBtn);

        this.appendChild(toggle);
        this.appendChild(row);

        // Wire up event listeners
        this.fileRadio.addEventListener("change", () =>
            this.handleSourceChange(),
        );
        this.urlRadio.addEventListener("change", () =>
            this.handleSourceChange(),
        );
        this.browseBtn.addEventListener("click", () => this.handleBrowse());
        this.textInput.addEventListener("change", () =>
            this.handleTextChange(),
        );
        this.textInput.addEventListener("keypress", (e) =>
            this.handleKeypress(e),
        );
    }

    /**
     * Returns the current BAM path or URL value.
     *
     * @returns The current BAM path or URL string.
     */
    get value(): string {
        return this.textInput.value;
    }

    /**
     * Sets the current BAM path or URL value.
     */
    set value(val: string) {
        this.textInput.value = val;
    }

    /**
     * Returns whether the element is in URL mode.
     *
     * @returns True if URL mode is active, false for file mode.
     */
    get isUrl(): boolean {
        return this.urlRadio.checked;
    }

    /**
     * Returns whether the element is disabled.
     *
     * @returns True if the input group is disabled.
     */
    get disabled(): boolean {
        return this.textInput.disabled;
    }

    /**
     * Enables or disables the entire input group.
     */
    set disabled(val: boolean) {
        this.textInput.disabled = val;
        this.browseBtn.disabled = val;
        this.fileRadio.disabled = val;
        this.urlRadio.disabled = val;
    }

    /**
     * Handles switching between file and URL radio modes.
     */
    private handleSourceChange(): void {
        const urlMode = this.urlRadio.checked;
        this.textInput.readOnly = !urlMode;
        this.browseBtn.style.display = urlMode ? "none" : "block";
        this.textInput.placeholder = urlMode
            ? "Enter BAM/CRAM URL"
            : "Select BAM/CRAM file";
        this.textInput.value = "";

        this.dispatchEvent(
            new CustomEvent("source-type-changed", { bubbles: true }),
        );
    }

    /**
     * Handles the Browse button click by calling selectFileFn.
     */
    private async handleBrowse(): Promise<void> {
        if (!this.selectFileFn) return;
        const path = await this.selectFileFn();
        if (path) {
            this.textInput.value = path;
            this.fireBamSelected();
        }
    }

    /**
     * Handles the text input change event in URL mode.
     */
    private handleTextChange(): void {
        if (this.isUrl && this.textInput.value.trim()) {
            this.fireBamSelected();
        }
    }

    /**
     * Handles keypress on the text input, firing bam-selected on Enter in URL mode.
     *
     * @param e - The keyboard event from the text input.
     */
    private handleKeypress(e: KeyboardEvent): void {
        if (e.key === "Enter" && this.isUrl) {
            this.fireBamSelected();
        }
    }

    /**
     * Dispatches the "bam-selected" custom event with the current value and mode.
     */
    private fireBamSelected(): void {
        this.dispatchEvent(
            new CustomEvent<BamSelectedDetail>("bam-selected", {
                bubbles: true,
                detail: {
                    value: this.textInput.value,
                    isUrl: this.isUrl,
                },
            }),
        );
    }
}

customElements.define("bam-resource-input", BamResourceInput);
