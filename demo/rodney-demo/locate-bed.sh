#!/usr/bin/env bash
# Locate-bed roundtrip test using rodney.
#
# Prerequisites:
#   npm run build && ./scripts/start-debug.sh   (leaves app on port 9222)
#
# Usage:
#   ./demo/rodney-demo/locate-bed.sh
#
# What it does:
#   1. Extracts column 4 of demo/swipe.bed to build a read-IDs input file.
#   2. Navigates to the landing page and opens the Locate Reads mode.
#   3. Injects file paths directly into the DOM and fires the custom events
#      the page already listens for (bam-selected, output-selected) — the
#      same pattern used by demo/take-screenshots.mjs for QC and Swipe modes.
#      No dialog overrides are needed; window.api is not touched.
#   4. The real IPC handlers (peekBam, locateGenerateBed) run against the
#      actual demo files.
#   5. Clicks Generate, waits for the results panel.
#   6. Sorts columns 1-4 of the output BED and of demo/swipe.bed and asserts
#      they are identical.
#   7. Saves three 1920x1080 screenshots to /tmp/rodney-locate-bed-<timestamp>/.
set -euo pipefail

# Wrap uvx rodney so it reads like a normal command throughout the script.
rodney() { uvx rodney "$@"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LANDING_URL="file://${PROJECT_ROOT}/dist/renderer/landing/landing.html?fontSize=medium"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="/tmp/rodney-locate-bed-${TS}"
mkdir -p "${OUT_DIR}"

# ── step 1: build the read-IDs file from column 4 of swipe.bed ──────────────
READ_IDS_FILE="${OUT_DIR}/read-ids.txt"
awk '{print $4}' "${PROJECT_ROOT}/demo/swipe.bed" > "${READ_IDS_FILE}"
READ_ID_COUNT="$(wc -l < "${READ_IDS_FILE}" | tr -d ' ')"
echo ""
echo "── locate-bed: input preparation ──"
echo ""
echo "  ✓  Read-IDs file: ${READ_IDS_FILE} (${READ_ID_COUNT} IDs)"

BAM_PATH="${PROJECT_ROOT}/demo/swipe.bam"
OUTPUT_BED="${OUT_DIR}/located.bed"

FAIL=0
check() {
    if ! "$@"; then
        echo "  ✗  FAIL: $*"
        FAIL=1
        return 1
    fi
}

echo ""
echo "── rodney test: locate-bed roundtrip ──"
echo ""

# ── connect and navigate to landing ─────────────────────────────────────────
rodney connect localhost:9222
rodney open "${LANDING_URL}"
rodney waitstable

# ── open Locate Reads mode ───────────────────────────────────────────────────
rodney click "#btn-locate"
rodney waitload
rodney wait "#btn-generate"
rodney waitstable

# ── screenshot 1: locate-config page, empty ─────────────────────────────────
rodney screenshot -w 1920 -h 1080 "${OUT_DIR}/01-locate-config-empty.png"
echo "  📸  ${OUT_DIR}/01-locate-config-empty.png"
echo ""

# ── inject BAM path and fire bam-selected ────────────────────────────────────
# Mirrors the pattern in demo/take-screenshots.mjs (QC mode):
#   set the internal text input value, then dispatch the bam-selected custom
#   event that locate-config.ts already listens for.  The listener calls the
#   real peekBam IPC and updateGenerateButton.
rodney js "(function() {
  var bs = document.getElementById('bam-source');
  var inp = bs.querySelector('input[type=text]');
  if (inp) inp.value = '${BAM_PATH}';
  bs.dispatchEvent(new CustomEvent('bam-selected', {
    bubbles: true,
    detail: { value: '${BAM_PATH}', isUrl: false }
  }));
})()"
# Wait for peekBam to resolve: updateSummary() appends #btn-more-info only
# after the IPC call returns.
rodney wait "#btn-more-info"
echo "  ✓  BAM selected and peeked"

# ── inject read-IDs path directly ────────────────────────────────────────────
# The read-IDs input is a plain readonly <input> with id="read-id-path".
# Setting its value here is enough: updateGenerateButton() reads this value
# when the output-selected event fires in the next step.
rodney js "document.getElementById('read-id-path').value = '${READ_IDS_FILE}'"
echo "  ✓  Read-IDs path injected"

# ── inject output path and fire output-selected ───────────────────────────────
# Set the internal text input value of the output-file-input custom element,
# then dispatch output-selected (requiresOverwrite: false because the output
# file does not exist yet).  The output-selected listener calls
# updateGenerateButton(), which now sees all three fields filled.
rodney js "(function() {
  var os = document.getElementById('output-source');
  var inp = os.querySelector('input[type=text]');
  if (inp) inp.value = '${OUTPUT_BED}';
  os.dispatchEvent(new CustomEvent('output-selected', {
    bubbles: true,
    detail: { value: '${OUTPUT_BED}', requiresOverwrite: false, overwriteConfirmed: false }
  }));
})()"
rodney sleep 0.5
echo "  ✓  Output path injected"

# ── assert Generate button is now enabled ────────────────────────────────────
if check rodney assert "document.getElementById('btn-generate').disabled" "false"; then
    echo "  ✓  Generate button enabled"
fi

# ── screenshot 2: all fields filled ──────────────────────────────────────────
rodney screenshot -w 1920 -h 1080 "${OUT_DIR}/02-locate-config-filled.png"
echo "  📸  ${OUT_DIR}/02-locate-config-filled.png"
echo ""

# ── click Generate — real locateGenerateBed IPC runs here ────────────────────
rodney click "#btn-generate"
# The loading overlay appears first; wait for showResults() to remove the
# "hidden" class from #results-section.
rodney wait "#results-section:not(.hidden)"
rodney waitstable

# ── screenshot 3: results panel at 1920x1080 ─────────────────────────────────
rodney screenshot -w 1920 -h 1080 "${OUT_DIR}/03-locate-results.png"
echo "  📸  ${OUT_DIR}/03-locate-results.png"
echo ""

# ── assert results text is non-empty ─────────────────────────────────────────
RESULTS_TEXT="$(rodney text '#results-content')"
if check [ -n "${RESULTS_TEXT}" ]; then
    echo "  ✓  Results: $(echo "${RESULTS_TEXT}" | head -1)"
fi

# ── BED file comparison ───────────────────────────────────────────────────────
echo ""
echo "── BED file comparison (columns 1-4, sorted) ──"
echo ""

if check [ -f "${OUTPUT_BED}" ]; then
    echo "  ✓  Output BED exists: ${OUTPUT_BED}"
fi

# Sort columns 1-4 of both files and compare.
# swipe.bed uses score 0/1 (col 5); locate output uses 1000. Only cols 1-4
# (contig, start, end, read_id) are compared.
SWIPE_SORTED="$(awk '{print $1"\t"$2"\t"$3"\t"$4}' "${PROJECT_ROOT}/demo/swipe.bed" | sort)"
OUTPUT_SORTED="$(awk '{print $1"\t"$2"\t"$3"\t"$4}' "${OUTPUT_BED}" | sort)"

if check [ "${SWIPE_SORTED}" = "${OUTPUT_SORTED}" ]; then
    echo "  ✓  Columns 1-4 of located BED match demo/swipe.bed exactly"
fi

# ── result ───────────────────────────────────────────────────────────────────
echo ""
if [ "${FAIL}" -ne 0 ]; then
    echo "RESULT: FAIL"
    exit 1
fi
echo "RESULT: PASS"
echo ""
