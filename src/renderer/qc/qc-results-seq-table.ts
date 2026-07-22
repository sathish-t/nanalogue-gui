import type { SeqTableRow } from "../../lib/types";

/** Maximum number of sequence characters to display before truncation. */
const SEQ_DISPLAY_LIMIT = 500;

/** Tracks the last-clicked row index for shift-click range selection. */
let lastClickedSeqRow = -1;

/**
 * Renders the sequence table or a skip-reason message into the container.
 *
 * @param containerId - The DOM element ID of the container.
 * @param rows - The sequence table rows, or undefined if skipped.
 * @param skipReason - The reason sequences were skipped, if applicable.
 * @param ambiguousReadIds - Read IDs excluded due to same-length alignments.
 */
export function renderSeqTable(
    containerId: string,
    rows: SeqTableRow[] | undefined,
    skipReason: string | undefined,
    ambiguousReadIds: string[] | undefined,
): void {
    lastClickedSeqRow = -1;

    const container = document.getElementById(containerId);
    if (!container) return;

    if (skipReason || !rows) {
        const msg = document.createElement("div");
        msg.className = "no-data-message";
        msg.textContent = `Sequences not available: ${skipReason ?? "unknown reason"}`;
        container.appendChild(msg);
        return;
    }

    // Append ambiguous read warning to the disclaimer paragraph
    if (ambiguousReadIds && ambiguousReadIds.length > 0) {
        const disclaimer = document.querySelector(".seq-disclaimer");
        if (disclaimer) {
            const warning = document.createElement("span");
            warning.className = "seq-ambiguous-warning";
            warning.textContent = ` ${ambiguousReadIds.length} read(s) excluded because multiple alignments had the same sequence length: ${ambiguousReadIds.join(", ")}.`;
            disclaimer.appendChild(warning);
        }
    }

    if (rows.length === 0) {
        const msg = document.createElement("div");
        msg.className = "no-data-message";
        msg.textContent = "No reads found in the specified region.";
        container.appendChild(msg);
        return;
    }

    // Identify read IDs with multiple alignments for visual grouping
    const multiAlignIds = new Set<string>();
    {
        const seen = new Set<string>();
        for (const row of rows) {
            if (seen.has(row.readId)) {
                multiAlignIds.add(row.readId);
            } else {
                seen.add(row.readId);
            }
        }
    }

    // Toolbar with copy button
    const toolbar = document.createElement("div");
    toolbar.className = "seq-toolbar";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "small-button";
    copyBtn.textContent = "Copy selected read IDs";
    copyBtn.disabled = true;
    toolbar.appendChild(copyBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "small-button";
    clearBtn.textContent = "Clear selection";
    clearBtn.disabled = true;
    toolbar.appendChild(clearBtn);

    const countLabel = document.createElement("span");
    countLabel.style.color = "#888";
    countLabel.style.fontSize = "0.857rem";
    const uniqueReadCount = new Set(rows.map((r) => r.readId)).size;
    countLabel.textContent = `${uniqueReadCount} read${uniqueReadCount !== 1 ? "s" : ""}`;
    toolbar.appendChild(countLabel);

    container.appendChild(toolbar);

    // Table wrapper for scrolling
    const wrapper = document.createElement("div");
    wrapper.className = "seq-table-wrapper";

    const table = document.createElement("table");
    table.className = "seq-table";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Read ID", "Avg Quality", "Sequence"]) {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    const selectedSet = new Set<number>();

    /** Updates the copy and clear button states based on current selection. */
    function updateCopyBtn(): void {
        const hasSelection = selectedSet.size > 0;
        copyBtn.disabled = !hasSelection;
        clearBtn.disabled = !hasSelection;
        // Show deduplicated count since multi-alignment rows share a readId
        const uniqueCount = new Set(
            Array.from(selectedSet).map((idx) => rows?.[idx].readId),
        ).size;
        copyBtn.textContent = hasSelection
            ? `Copy ${uniqueCount} selected read ID${uniqueCount !== 1 ? "s" : ""}`
            : "Copy selected read IDs";
    }

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const tr = document.createElement("tr");
        if (multiAlignIds.has(row.readId)) {
            tr.classList.add("seq-multi-align");
        }

        // Read ID cell (clickable to copy)
        const readIdTd = document.createElement("td");
        const readIdSpan = document.createElement("span");
        readIdSpan.className = "seq-read-id";
        readIdSpan.textContent = row.readId;
        readIdSpan.title = "Click to copy read ID";
        readIdSpan.addEventListener("click", (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(row.readId).then(
                () => {
                    const tooltip = document.createElement("span");
                    tooltip.className = "seq-copied-tooltip";
                    tooltip.textContent = "Copied!";
                    readIdSpan.style.position = "relative";
                    readIdSpan.appendChild(tooltip);
                    setTimeout(() => tooltip.remove(), 1200);
                },
                (err) => {
                    console.error("Failed to copy read ID:", err);
                },
            );
        });
        readIdTd.appendChild(readIdSpan);
        tr.appendChild(readIdTd);

        // Avg quality cell
        const qualTd = document.createElement("td");
        qualTd.textContent =
            row.avgQuality !== null ? row.avgQuality.toFixed(1) : "N/A";
        tr.appendChild(qualTd);

        // Sequence cell with modification highlighting and quality tooltips
        const seqTd = document.createElement("td");
        const displayLen = Math.min(row.sequence.length, SEQ_DISPLAY_LIMIT);

        for (let j = 0; j < displayLen; j++) {
            const span = document.createElement("span");
            const quality =
                j < row.qualities.length ? String(row.qualities[j]) : "N/A";
            span.title = `Quality: ${quality}`;

            // Mark modified bases (where tagged sequence differs from base sequence)
            // and display the underlying base letter rather than the tag character (Z/z)
            const isModified =
                j < row.baseSequence.length &&
                row.sequence[j] !== row.baseSequence[j];

            if (isModified) {
                span.className = "seq-mod-base";
                span.textContent = row.baseSequence[j];
            } else {
                span.textContent = row.sequence[j];
            }

            seqTd.appendChild(span);
        }

        if (row.sequence.length > SEQ_DISPLAY_LIMIT) {
            const truncSpan = document.createElement("span");
            truncSpan.className = "seq-truncated";
            truncSpan.textContent = ` ... (${row.sequence.length - SEQ_DISPLAY_LIMIT} more)`;
            seqTd.appendChild(truncSpan);
        }

        tr.appendChild(seqTd);

        // Row selection (click and shift-click)
        tr.addEventListener("click", (e) => {
            if (e.shiftKey && lastClickedSeqRow >= 0) {
                const start = Math.min(lastClickedSeqRow, i);
                const end = Math.max(lastClickedSeqRow, i);
                for (let k = start; k <= end; k++) {
                    selectedSet.add(k);
                    tbody.children[k]?.classList.add("seq-selected");
                }
            } else if (selectedSet.has(i)) {
                selectedSet.delete(i);
                tr.classList.remove("seq-selected");
            } else {
                selectedSet.add(i);
                tr.classList.add("seq-selected");
            }
            lastClickedSeqRow = i;
            updateCopyBtn();
        });

        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);

    // Copy button handler
    copyBtn.addEventListener("click", () => {
        const ids = [
            ...new Set(
                Array.from(selectedSet)
                    .sort((a, b) => a - b)
                    .map((idx) => rows[idx].readId),
            ),
        ].join("\n");
        navigator.clipboard.writeText(ids).catch((err) => {
            console.error("Failed to copy read IDs:", err);
        });
    });

    // Clear selection handler
    clearBtn.addEventListener("click", () => {
        for (const idx of selectedSet) {
            tbody.children[idx]?.classList.remove("seq-selected");
        }
        selectedSet.clear();
        lastClickedSeqRow = -1;
        updateCopyBtn();
    });
}
