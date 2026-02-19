// Reusable custom element for window size input with inline validation.
// Renders a heading, number input, unit label, hint, and validation message.

/** Minimum allowed window size. */
const MIN_WINDOW_SIZE = 2;

/** Maximum allowed window size. */
const MAX_WINDOW_SIZE = 10_000;

/** Monotonically increasing counter to generate unique input IDs. */
let instanceCounter = 0;

/** Detail payload for the "window-size-changed" custom event. */
export interface WindowSizeChangedDetail {
    /** The parsed integer value. */
    value: number;
    /** Whether the current value is within the valid range. */
    isValid: boolean;
}

/**
 * Custom element providing a window size number input with inline validation.
 *
 * Renders a heading, number input with unit label, a hint about bases of
 * interest, and an inline validation warning. Fires "window-size-changed"
 * on every input change.
 */
export class WindowSizeInput extends HTMLElement {
    /** Number input for the window size. */
    private numberInput!: HTMLInputElement;

    /** Validation hint paragraph shown when input is out of range. */
    private validationHint!: HTMLParagraphElement;

    /** Whether the DOM has already been built by a previous connectedCallback. */
    private initialized = false;

    /**
     * Builds the element's light-DOM content on first connection.
     */
    connectedCallback(): void {
        if (this.initialized) return;
        this.initialized = true;

        const inputId = `window-size-input-${instanceCounter++}`;

        // Section heading
        const heading = document.createElement("h2");
        heading.textContent = "Window size ";
        const optional = document.createElement("span");
        optional.className = "optional";
        optional.textContent = "(for windowed density)";
        heading.appendChild(optional);
        this.appendChild(heading);

        // Accessible label linked to the input
        const label = document.createElement("label");
        label.className = "visually-hidden";
        label.textContent = "Window size";
        label.htmlFor = inputId;
        this.appendChild(label);

        // Input wrapper
        const wrapper = document.createElement("div");
        wrapper.className = "input-with-unit";

        this.numberInput = document.createElement("input");
        this.numberInput.type = "number";
        this.numberInput.id = inputId;
        this.numberInput.value = "300";
        this.numberInput.min = String(MIN_WINDOW_SIZE);
        this.numberInput.max = String(MAX_WINDOW_SIZE);
        this.numberInput.step = "10";
        wrapper.appendChild(this.numberInput);

        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = "bases of interest";
        wrapper.appendChild(unit);

        this.appendChild(wrapper);

        // Hint about bases of interest
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent =
            "Windows are counted in bases of interest (e.g., thymidines), not total genomic bases.";
        this.appendChild(hint);

        // Validation hint (hidden by default)
        this.validationHint = document.createElement("p");
        this.validationHint.className = "hint warning hidden";
        this.validationHint.textContent =
            "Window size must be between 2 and 10,000.";
        this.appendChild(this.validationHint);

        // Wire input listener
        this.numberInput.addEventListener("input", () => this.handleInput());
    }

    /**
     * Returns the parsed numeric value of the input, or NaN if empty/invalid.
     *
     * @returns The parsed numeric value.
     */
    get value(): number {
        const raw = this.numberInput.value.trim();
        return raw === "" ? Number.NaN : Number(raw);
    }

    /**
     * Returns whether the current value is a valid integer within the allowed range.
     *
     * @returns True if the value is an integer between MIN_WINDOW_SIZE and MAX_WINDOW_SIZE inclusive.
     */
    get isValid(): boolean {
        const v = this.value;
        return (
            Number.isInteger(v) && v >= MIN_WINDOW_SIZE && v <= MAX_WINDOW_SIZE
        );
    }

    /**
     * Updates the validation hint visibility based on the current value.
     */
    private updateValidationHint(): void {
        if (this.isValid) {
            this.validationHint.classList.add("hidden");
        } else {
            this.validationHint.classList.remove("hidden");
        }
    }

    /**
     * Handles input events by updating validation and dispatching the change event.
     */
    private handleInput(): void {
        this.updateValidationHint();
        this.dispatchEvent(
            new CustomEvent<WindowSizeChangedDetail>("window-size-changed", {
                bubbles: true,
                detail: {
                    value: this.value,
                    isValid: this.isValid,
                },
            }),
        );
    }
}

customElements.define("window-size-input", WindowSizeInput);
