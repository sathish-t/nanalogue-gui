// Tests for getChartFontSizes() — verifies that the correct pixel sizes are
// returned for each of the three font-size presets and for the fallback case.

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getChartFontSizes } from "./chart-font-size";

/**
 * Removes all font-size classes from the document root element.
 */
function clearFontClasses(): void {
    document.documentElement.classList.remove(
        "font-small",
        "font-medium",
        "font-large",
    );
}

afterEach(() => {
    clearFontClasses();
});

describe("getChartFontSizes", () => {
    it("returns medium sizes when no font class is set", () => {
        clearFontClasses();
        const sizes = getChartFontSizes();
        expect(sizes.tick).toBe(12);
        expect(sizes.title).toBe(13);
        expect(sizes.legend).toBe(12);
    });

    it("returns medium sizes when font-medium class is set", () => {
        document.documentElement.classList.add("font-medium");
        const sizes = getChartFontSizes();
        expect(sizes.tick).toBe(12);
        expect(sizes.title).toBe(13);
        expect(sizes.legend).toBe(12);
    });

    it("returns small sizes when font-small class is set", () => {
        document.documentElement.classList.add("font-small");
        const sizes = getChartFontSizes();
        expect(sizes.tick).toBe(10);
        expect(sizes.title).toBe(11);
        expect(sizes.legend).toBe(11);
    });

    it("returns large sizes when font-large class is set", () => {
        document.documentElement.classList.add("font-large");
        const sizes = getChartFontSizes();
        expect(sizes.tick).toBe(15);
        expect(sizes.title).toBe(17);
        expect(sizes.legend).toBe(16);
    });

    it("small sizes are strictly less than medium sizes", () => {
        document.documentElement.classList.add("font-small");
        const small = getChartFontSizes();
        clearFontClasses();
        const medium = getChartFontSizes();
        expect(small.tick).toBeLessThan(medium.tick);
        expect(small.title).toBeLessThan(medium.title);
        expect(small.legend).toBeLessThan(medium.legend);
    });

    it("large sizes are strictly greater than medium sizes", () => {
        document.documentElement.classList.add("font-large");
        const large = getChartFontSizes();
        clearFontClasses();
        const medium = getChartFontSizes();
        expect(large.tick).toBeGreaterThan(medium.tick);
        expect(large.title).toBeGreaterThan(medium.title);
        expect(large.legend).toBeGreaterThan(medium.legend);
    });
});
