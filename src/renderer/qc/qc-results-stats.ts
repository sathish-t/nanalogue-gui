import { formatNumber } from "../../lib/format-utils";
import type { Stats, YieldBin } from "../../lib/stats";
import type { ReadTypeCounts } from "./qc-results-types";

/**
 * A labeled numeric value for display in a stats grid.
 */
interface LabeledValue {
    /** Display label for the statistic. */
    label: string;
    /** Numeric value of the statistic. */
    value: number;
}

/**
 * Renders a summary statistics panel into the specified container element.
 *
 * Displays essential statistics (count, median, mean) by default and provides
 * an expandable section for additional percentile and deviation metrics.
 *
 * @param containerId - The DOM element ID of the container to render into.
 * @param stats - The summary statistics to display.
 * @param showN50 - Whether to include the N50 metric in the essential stats.
 * @param note - Optional small note rendered below the header.
 * @param readTypeCounts - Optional read type counts to display in the expanded section.
 */
export function renderStatsPanel(
    containerId: string,
    stats: Stats,
    showN50: boolean = false,
    note?: string,
    readTypeCounts?: ReadTypeCounts,
): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const essentialStats = [
        { label: "Count", value: stats.count.toLocaleString() },
        { label: "Median", value: formatNumber(stats.p50) },
        { label: "Mean", value: formatNumber(stats.mean) },
    ];

    if (showN50 && stats.n50 !== undefined) {
        essentialStats.push({ label: "N50", value: formatNumber(stats.n50) });
    }

    const expandedStats = [
        { label: "Min", value: formatNumber(stats.min) },
        { label: "P10", value: formatNumber(stats.p10) },
        { label: "P90", value: formatNumber(stats.p90) },
        { label: "Max", value: formatNumber(stats.max) },
        { label: "Std Dev", value: formatNumber(stats.stddev) },
    ];

    const noteHtml = note ? `<p class="alignment-note">${note}</p>` : "";

    container.innerHTML = `
    <div class="stats-header">
      <h3>Summary Statistics</h3>
      <button class="stats-toggle">
        Show all stats
      </button>
    </div>
    ${noteHtml}
    <div class="stats-grid">
      ${essentialStats
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
    <div class="stats-grid stats-expanded">
      ${expandedStats
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
  `;

    // Append read type counts grid to the expanded section when provided
    if (readTypeCounts) {
        const expandedGrid = container.querySelector(".stats-expanded");
        if (expandedGrid) {
            const readTypeSection = document.createElement("div");
            readTypeSection.className = "read-type-counts stats-expanded";

            const heading = document.createElement("h4");
            heading.className = "read-type-heading";
            heading.textContent = "Read Types";
            readTypeSection.appendChild(heading);

            const grid = document.createElement("div");
            grid.className = "stats-grid";

            /** Label-value pairs for each read type count. */
            const items: LabeledValue[] = [
                { label: "Primary fwd", value: readTypeCounts.primaryForward },
                { label: "Primary rev", value: readTypeCounts.primaryReverse },
                {
                    label: "Secondary fwd",
                    value: readTypeCounts.secondaryForward,
                },
                {
                    label: "Secondary rev",
                    value: readTypeCounts.secondaryReverse,
                },
                {
                    label: "Suppl. fwd",
                    value: readTypeCounts.supplementaryForward,
                },
                {
                    label: "Suppl. rev",
                    value: readTypeCounts.supplementaryReverse,
                },
                { label: "Unmapped", value: readTypeCounts.unmapped },
            ];

            for (const item of items) {
                const div = document.createElement("div");
                div.className = "stat-item";

                const labelSpan = document.createElement("span");
                labelSpan.className = "label";
                labelSpan.textContent = `${item.label}: `;

                const valueSpan = document.createElement("span");
                valueSpan.className = "value";
                valueSpan.textContent = item.value.toLocaleString();

                div.append(labelSpan, valueSpan);
                grid.appendChild(div);
            }

            readTypeSection.appendChild(grid);
            expandedGrid.after(readTypeSection);
        }
    }

    const toggleBtn = container.querySelector(".stats-toggle");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            container.classList.toggle("expanded");
            toggleBtn.textContent = toggleBtn.textContent?.includes("Show")
                ? "Hide all stats"
                : "Show all stats";
        });
    }
}

/**
 * Renders a minimal yield summary showing total yield and N50.
 *
 * @param containerId - The DOM element ID of the container to render into.
 * @param yieldBins - The yield bins bucketed by read length.
 * @param readLengthStats - The read length stats containing the N50 value.
 * @param note - Optional small note rendered below the summary.
 */
export function renderYieldSummary(
    containerId: string,
    yieldBins: YieldBin[],
    readLengthStats: Stats,
    note?: string,
): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    let totalYield = 0;
    for (const bin of yieldBins) {
        totalYield += bin.yield;
    }

    const items = [{ label: "Total Yield", value: formatNumber(totalYield) }];

    if (readLengthStats.n50 !== undefined) {
        items.push({ label: "N50", value: formatNumber(readLengthStats.n50) });
    }

    const noteHtml = note ? `<p class="alignment-note">${note}</p>` : "";

    container.innerHTML = `
    <div class="stats-grid">
      ${items
          .map(
              (s) => `
        <div class="stat-item">
          <span class="label">${s.label}:</span>
          <span class="value">${s.value}</span>
        </div>
      `,
          )
          .join("")}
    </div>
    ${noteHtml}
  `;
}
