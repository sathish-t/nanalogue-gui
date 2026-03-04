// Reads the font-size CSS class applied to <html> by applyFontSize() and
// returns Chart.js font-size values so tick labels, axis titles, and legend
// labels all scale with the user's chosen preset.
// Call getChartFontSizes() after applyFontSize() inside any renderer that
// creates Chart.js charts.

/**
 * Font sizes (in pixels) to pass to Chart.js configuration objects, scaled
 * to match the user's chosen font-size preset.
 */
export interface ChartFontSizes {
    /** Font size in pixels for axis tick labels. */
    tick: number;
    /** Font size in pixels for axis title labels. */
    title: number;
    /** Font size in pixels for chart legend labels. */
    legend: number;
}

/** Pixel sizes used for the small font-size preset (12 px root). */
const SMALL: ChartFontSizes = { tick: 10, title: 11, legend: 11 };

/** Pixel sizes used for the medium font-size preset (14 px root — Chart.js default). */
const MEDIUM: ChartFontSizes = { tick: 12, title: 13, legend: 12 };

/** Pixel sizes used for the large font-size preset (18 px root). */
const LARGE: ChartFontSizes = { tick: 15, title: 17, legend: 16 };

/**
 * Returns Chart.js font sizes scaled to match the active font-size preset.
 *
 * Reads the font-small, font-medium, or font-large CSS class from the root
 * {@link HTMLElement} that was set by {@link applyFontSize}. Falls back to
 * medium when no recognised class is present.
 *
 * @returns The {@link ChartFontSizes} for the currently active preset.
 */
export function getChartFontSizes(): ChartFontSizes {
    const classes = document.documentElement.classList;
    if (classes.contains("font-small")) return SMALL;
    if (classes.contains("font-large")) return LARGE;
    return MEDIUM;
}
