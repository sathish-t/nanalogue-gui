// Shared font-size state for the main process.
// Both main.ts and mode modules read this to pass the correct query param
// to every loadFile call so child pages pick up the user's preference.

/** The three font-size presets available in the application. */
export type FontSize = "small" | "medium" | "large";

/** Currently selected font size. Defaults to medium; never persisted to disk. */
let currentFontSize: FontSize = "medium";

/**
 * Returns the currently selected font size.
 *
 * @returns The active FontSize value.
 */
export function getFontSize(): FontSize {
    return currentFontSize;
}

/**
 * Updates the current font size.
 *
 * @param size - The new font size to apply.
 */
export function setFontSize(size: FontSize): void {
    currentFontSize = size;
}
