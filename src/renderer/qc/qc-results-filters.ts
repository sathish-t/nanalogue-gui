import type { HistogramBin } from "../../lib/stats";
import { renderHistogram } from "./qc-results-charts";
import type { ChartInstance } from "./qc-results-types";

/**
 * Sets up a histogram range filter toggle and apply button for the given ID prefix.
 *
 * @param charts - Registry of active charts keyed by canvas ID.
 * @param idPrefix - The ID prefix for the filter DOM elements (e.g. "probability-filter").
 * @param getFullBins - A function returning the full unfiltered histogram bins.
 * @param chartId - The DOM element ID of the chart canvas to re-render.
 * @param xLabel - The x-axis label for the chart.
 * @param statsPanelId - The DOM element ID of the stats panel to annotate when filtered.
 */
export function setupHistogramFilter(
    charts: Map<string, ChartInstance>,
    idPrefix: string,
    getFullBins: () => HistogramBin[],
    chartId: string,
    xLabel: string,
    statsPanelId: string,
): void {
    const filterContainer = document.getElementById(idPrefix);

    // Hide filter controls when there is no data to filter
    if (getFullBins().length === 0) {
        if (filterContainer) {
            filterContainer.classList.add("hidden");
        }
        return;
    }

    const toggle = document.getElementById(
        `${idPrefix}-toggle`,
    ) as HTMLInputElement | null;
    const inputsContainer = document.getElementById(`${idPrefix}-inputs`);
    const lowInput = document.getElementById(
        `${idPrefix}-low`,
    ) as HTMLInputElement | null;
    const highInput = document.getElementById(
        `${idPrefix}-high`,
    ) as HTMLInputElement | null;
    const applyBtn = document.getElementById(`${idPrefix}-apply`);
    const errorEl = document.getElementById(`${idPrefix}-error`);
    const statsPanel = document.getElementById(statsPanelId);

    if (
        !toggle ||
        !inputsContainer ||
        !lowInput ||
        !highInput ||
        !applyBtn ||
        !errorEl
    ) {
        return;
    }

    /**
     * Adds or removes the "(all reads)" annotation on the stats panel.
     *
     * @param show - Whether to show the annotation.
     */
    function setStatsAnnotation(show: boolean): void {
        if (!statsPanel) return;
        const existing = statsPanel.querySelector(".stats-filter-note");
        if (show && !existing) {
            const note = document.createElement("span");
            note.className = "stats-filter-note";
            note.textContent = " (all reads)";
            note.style.fontWeight = "normal";
            note.style.color = "#999";
            note.style.fontSize = "0.857rem";
            statsPanel.prepend(note);
        } else if (!show && existing) {
            existing.remove();
        }
    }

    toggle.addEventListener("change", () => {
        if (toggle.checked) {
            inputsContainer.classList.remove("hidden");
        } else {
            inputsContainer.classList.add("hidden");
            errorEl.classList.add("hidden");
            setStatsAnnotation(false);
            // Restore full histogram
            renderHistogram(charts, chartId, getFullBins(), xLabel);
        }
    });

    applyBtn.addEventListener("click", () => {
        const low = parseFloat(lowInput.value);
        const high = parseFloat(highInput.value);

        if (
            Number.isNaN(low) ||
            Number.isNaN(high) ||
            low < 0 ||
            high > 1 ||
            low >= high
        ) {
            errorEl.textContent =
                "Low must be less than high, both between 0 and 1.";
            errorEl.classList.remove("hidden");
            return;
        }

        errorEl.classList.add("hidden");

        // Filter bins that overlap with the requested range
        const filteredBins = getFullBins().filter((b) => {
            return b.binEnd > low && b.binStart < high;
        });

        if (filteredBins.length === 0) {
            errorEl.textContent = "No bins in the specified range.";
            errorEl.classList.remove("hidden");
            return;
        }

        renderHistogram(charts, chartId, filteredBins, xLabel);
        setStatsAnnotation(true);
    });
}
