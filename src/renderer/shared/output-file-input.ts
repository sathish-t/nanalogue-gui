// Reusable custom element for output file selection with overwrite confirmation.
// Renders a file-input-row with Browse button, and conditional overwrite warning + checkbox.

/**
 * Detail payload for the "output-selected" custom event.
 */
export interface OutputSelectedDetail {
    /** The selected output file path. */
    value: string;
    /** Whether the selected path points to an existing file. */
    requiresOverwrite: boolean;
    /** Whether the user has confirmed the overwrite via the checkbox. */
    overwriteConfirmed: boolean;
}

/**
 * Custom element providing an output file input with overwrite confirmation.
 *
 * Renders a file-input-row containing a readonly text input and Browse button.
 * When a path is selected, checks whether the file already exists. If so,
 * displays an orange warning and a confirmation checkbox. The element fires
 * "output-selected" when a file is chosen and "overwrite-confirmed" when the
 * checkbox is toggled. External callers can also use showWarning/hideWarning
 * to display path-collision or other validation warnings.
 */
export class OutputFileInput extends HTMLElement {
    /** Readonly text input displaying the selected output path. */
    private textInput!: HTMLInputElement;

    /** Browse button for opening a native file dialog. */
    private browseBtn!: HTMLButtonElement;

    /** Warning paragraph shown when the output file already exists. */
    private warningText!: HTMLParagraphElement;

    /** Label wrapping the overwrite confirmation checkbox. */
    private confirmLabel!: HTMLLabelElement;

    /** Checkbox requiring explicit acknowledgement before overwriting. */
    private confirmCheckbox!: HTMLInputElement;

    /** Whether the DOM has already been built by a previous connectedCallback. */
    private initialized = false;

    /** Whether the currently selected file requires an overwrite. */
    private fileRequiresOverwrite = false;

    /**
     * Pluggable callback invoked when the Browse button is clicked.
     * Should return the selected file path, or null if cancelled.
     */
    selectFileFn: (() => Promise<string | null>) | null = null;

    /**
     * Pluggable callback invoked after a path is selected to check whether
     * the file already exists. Should return true if the file exists.
     */
    checkExistsFn: ((path: string) => Promise<boolean>) | null = null;

    /**
     * Builds the element's light-DOM content on first connection.
     */
    connectedCallback(): void {
        if (this.initialized) return;
        this.initialized = true;

        // File input row
        const row = document.createElement("div");
        row.className = "file-input-row";

        const inputId = `output-file-input-${crypto.randomUUID()}`;

        const hiddenLabel = document.createElement("label");
        hiddenLabel.className = "visually-hidden";
        hiddenLabel.htmlFor = inputId;
        hiddenLabel.textContent = "Output file path";
        row.appendChild(hiddenLabel);

        this.textInput = document.createElement("input");
        this.textInput.id = inputId;
        this.textInput.type = "text";
        this.textInput.placeholder = "Select output file location";
        this.textInput.readOnly = true;
        row.appendChild(this.textInput);

        this.browseBtn = document.createElement("button");
        this.browseBtn.type = "button";
        this.browseBtn.textContent = "Browse";
        row.appendChild(this.browseBtn);

        this.appendChild(row);

        // Warning text (hidden by default)
        this.warningText = document.createElement("p");
        this.warningText.className = "file-exists-warning hidden";
        this.appendChild(this.warningText);

        // Overwrite confirmation checkbox (hidden by default)
        this.confirmLabel = document.createElement("label");
        this.confirmLabel.className = "overwrite-confirm hidden";

        this.confirmCheckbox = document.createElement("input");
        this.confirmCheckbox.type = "checkbox";
        this.confirmLabel.appendChild(this.confirmCheckbox);
        this.confirmLabel.appendChild(
            document.createTextNode(
                " I understand this file will be overwritten",
            ),
        );
        this.appendChild(this.confirmLabel);

        // Wire up event listeners
        this.browseBtn.addEventListener("click", () => this.handleBrowse());
        this.confirmCheckbox.addEventListener("change", () =>
            this.handleCheckboxChange(),
        );
    }

    /**
     * Returns the current output file path.
     *
     * @returns The current output file path string.
     */
    get value(): string {
        return this.textInput.value;
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
        this.confirmCheckbox.disabled = val;
    }

    /**
     * Returns whether the currently selected file already exists and needs overwriting.
     *
     * @returns True if the selected path points to an existing file.
     */
    get requiresOverwrite(): boolean {
        return this.fileRequiresOverwrite;
    }

    /**
     * Returns whether the user has confirmed the overwrite via the checkbox.
     *
     * @returns True if the overwrite checkbox is checked.
     */
    get overwriteConfirmed(): boolean {
        return this.confirmCheckbox.checked;
    }

    /**
     * Displays a warning message below the file input.
     * Used externally for path-collision or other validation warnings.
     *
     * @param message - The warning text to display.
     * @param hideCheckbox - When true, hides the overwrite confirmation checkbox.
     */
    showWarning(message: string, hideCheckbox: boolean): void {
        this.warningText.textContent = message;
        this.warningText.classList.remove("hidden");
        if (hideCheckbox) {
            this.confirmLabel.classList.add("hidden");
        } else {
            this.confirmLabel.classList.remove("hidden");
        }
    }

    /**
     * Hides the warning text and overwrite confirmation checkbox.
     */
    hideWarning(): void {
        this.warningText.classList.add("hidden");
        this.confirmLabel.classList.add("hidden");
    }

    /**
     * Handles the Browse button click by calling selectFileFn then checkExistsFn.
     */
    private async handleBrowse(): Promise<void> {
        if (!this.selectFileFn) return;
        const path = await this.selectFileFn();
        if (!path) return;

        this.textInput.value = path;
        this.confirmCheckbox.checked = false;
        this.fileRequiresOverwrite = false;

        // Check if file exists
        let exists = false;
        if (this.checkExistsFn) {
            try {
                exists = await this.checkExistsFn(path);
            } catch (error) {
                console.error("Failed to check file exists:", error);
            }
        }

        // Guard against stale results if the user picked a different file
        if (path !== this.textInput.value) return;

        this.fileRequiresOverwrite = exists;
        if (exists) {
            this.warningText.textContent =
                "This file already exists and will be overwritten.";
            this.warningText.classList.remove("hidden");
            this.confirmLabel.classList.remove("hidden");
        } else {
            this.warningText.classList.add("hidden");
            this.confirmLabel.classList.add("hidden");
        }

        this.fireOutputSelected();
    }

    /**
     * Handles the overwrite confirmation checkbox toggle.
     */
    private handleCheckboxChange(): void {
        this.dispatchEvent(
            new CustomEvent("overwrite-confirmed", { bubbles: true }),
        );
        this.fireOutputSelected();
    }

    /**
     * Dispatches the "output-selected" custom event with the current state.
     */
    private fireOutputSelected(): void {
        this.dispatchEvent(
            new CustomEvent<OutputSelectedDetail>("output-selected", {
                bubbles: true,
                detail: {
                    value: this.textInput.value,
                    requiresOverwrite: this.fileRequiresOverwrite,
                    overwriteConfirmed: this.confirmCheckbox.checked,
                },
            }),
        );
    }
}

customElements.define("output-file-input", OutputFileInput);
