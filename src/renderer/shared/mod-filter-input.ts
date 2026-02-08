// Reusable custom element for modification filter input with validation.
// Wraps parseModFilter and provides a public API for parent pages.

import { parseModFilter } from "../../lib/mod-filter";

/** Monotonically increasing counter to generate unique input IDs. */
let instanceCounter = 0;

/**
 * Detail payload for the "mod-filter-changed" custom event.
 */
export interface ModFilterChangedDetail {
    /** The parsed modification tag, or undefined if invalid. */
    tag: string | undefined;
    /** The parsed strand direction, or undefined if invalid. */
    modStrand: "bc" | "bc_comp" | undefined;
    /** Whether the current input represents a valid modification filter. */
    isValid: boolean;
}

/**
 * Custom element providing a modification filter input with validation hints.
 *
 * Renders a heading, text input, strand convention hint, and a validation
 * warning. Parents control when validation is shown via the showValidation
 * property. Fires "mod-filter-changed" on every input keystroke.
 */
export class ModFilterInput extends HTMLElement {
    /** Text input for the modification filter string. */
    private textInput!: HTMLInputElement;

    /** Validation hint paragraph shown when input is invalid. */
    private validationHint!: HTMLParagraphElement;

    /** Whether the DOM has already been built by a previous connectedCallback. */
    private initialized = false;

    /** Whether validation hints are currently enabled by the parent. */
    private validationVisible = false;

    /**
     * Builds the element's light-DOM content on first connection.
     */
    connectedCallback(): void {
        if (this.initialized) return;
        this.initialized = true;

        // Section heading
        const heading = document.createElement("h2");
        heading.textContent = "Modification filter";
        this.appendChild(heading);

        // Text input
        const inputId = `mod-filter-input-${instanceCounter++}`;
        this.textInput = document.createElement("input");
        this.textInput.type = "text";
        this.textInput.id = inputId;
        this.textInput.placeholder = "e.g. +T, -m, +a";

        // Accessible label linked to the input
        const label = document.createElement("label");
        label.className = "visually-hidden";
        label.textContent = "Modification filter";
        label.htmlFor = inputId;
        this.appendChild(label);

        this.appendChild(this.textInput);

        // Strand convention hint
        const strandHint = document.createElement("p");
        strandHint.className = "hint";
        strandHint.textContent = "+ = basecalled strand, - = opposite strand";
        this.appendChild(strandHint);

        // Validation hint (hidden by default)
        this.validationHint = document.createElement("p");
        this.validationHint.className = "hint warning hidden";
        this.validationHint.textContent =
            "Required \u2014 enter a modification tag to proceed";
        this.appendChild(this.validationHint);

        // Wire input listener
        this.textInput.addEventListener("input", () => this.handleInput());
    }

    /**
     * Returns the current filter input text.
     *
     * @returns The current text value of the modification filter input.
     */
    get value(): string {
        return this.textInput.value;
    }

    /**
     * Sets the filter input text.
     */
    set value(val: string) {
        this.textInput.value = val;
    }

    /**
     * Returns the parsed modification tag, or undefined if the input is invalid.
     *
     * @returns The parsed tag string, or undefined.
     */
    get tag(): string | undefined {
        return parseModFilter(this.textInput.value).tag;
    }

    /**
     * Returns the parsed strand direction, or undefined if the input is invalid.
     *
     * @returns The strand direction, or undefined.
     */
    get modStrand(): "bc" | "bc_comp" | undefined {
        return parseModFilter(this.textInput.value).modStrand;
    }

    /**
     * Returns whether the current input is a valid modification filter.
     *
     * @returns True if the input parses to a valid tag.
     */
    get isValid(): boolean {
        return Boolean(parseModFilter(this.textInput.value).tag);
    }

    /**
     * Controls whether validation hints are shown.
     * When true and the input is invalid, shows the appropriate hint text.
     * When false, hides the validation hint.
     *
     * @returns Whether validation hints are currently enabled.
     */
    get showValidation(): boolean {
        return this.validationVisible;
    }

    /**
     * Sets whether validation hints should be displayed.
     */
    set showValidation(val: boolean) {
        this.validationVisible = val;
        this.updateValidationHint();
    }

    /**
     * Sets the value to the first modification if the current value is invalid,
     * then fires the change event.
     *
     * @param modifications - Array of modification strings detected in the BAM.
     */
    autoPopulate(modifications: string[]): void {
        if (modifications.length > 0 && !this.isValid) {
            this.textInput.value = modifications[0];
            this.handleInput();
        }
    }

    /**
     * Updates the validation hint text and visibility based on current state.
     */
    private updateValidationHint(): void {
        if (this.validationVisible && !this.isValid) {
            const trimmed = this.textInput.value.trim();
            this.validationHint.textContent =
                trimmed.length > 0
                    ? "Invalid format \u2014 use +TAG or -TAG (e.g. +T, -m)"
                    : "Required \u2014 enter a modification tag to proceed";
            this.validationHint.classList.remove("hidden");
        } else {
            this.validationHint.classList.add("hidden");
        }
    }

    /**
     * Handles input events by updating the validation hint and dispatching the change event.
     */
    private handleInput(): void {
        this.updateValidationHint();
        this.dispatchEvent(
            new CustomEvent<ModFilterChangedDetail>("mod-filter-changed", {
                bubbles: true,
                detail: {
                    tag: this.tag,
                    modStrand: this.modStrand,
                    isValid: this.isValid,
                },
            }),
        );
    }
}

customElements.define("mod-filter-input", ModFilterInput);
