// Reusable custom element for local BAM file selection.

/**
 * Detail payload for the "bam-selected" custom event.
 */
export interface BamSelectedDetail {
    /** The selected local BAM path. */
    value: string;
}

/**
 * Custom element providing a read-only local BAM path and native Browse button.
 * Fires "bam-selected" when a file is chosen.
 */
export class BamResourceInput extends HTMLElement {
    /** Text input for the local BAM path. */
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

        this.appendChild(row);

        // Wire up event listeners
        this.browseBtn.addEventListener("click", () => this.handleBrowse());
    }

    /**
     * Returns the current local BAM path.
     *
     * @returns The current local BAM path.
     */
    get value(): string {
        return this.textInput.value;
    }

    /**
     * Sets the current local BAM path.
     */
    set value(val: string) {
        this.textInput.value = val;
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

    /** Dispatches the "bam-selected" custom event with the selected local path. */
    private fireBamSelected(): void {
        this.dispatchEvent(
            new CustomEvent<BamSelectedDetail>("bam-selected", {
                bubbles: true,
                detail: {
                    value: this.textInput.value,
                },
            }),
        );
    }
}

customElements.define("bam-resource-input", BamResourceInput);
