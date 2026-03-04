// Reads the fontSize URL query parameter and applies the matching CSS class
// to <html> so all rem-based font sizes scale correctly.
// Call this once at the top of every renderer entry-point module.

/**
 * Reads the fontSize URL query parameter and applies the matching CSS class
 * (font-small, font-medium, or font-large) to the document root element.
 * Removes any previously set font-size class first to avoid stale state.
 */
export function applyFontSize(): void {
    const params = new URLSearchParams(window.location.search);
    const fontSize = params.get("fontSize") ?? "medium";
    const html = document.documentElement;
    html.classList.remove("font-small", "font-medium", "font-large");
    html.classList.add(`font-${fontSize}`);
}
