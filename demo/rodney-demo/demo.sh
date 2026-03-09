#!/usr/bin/env bash
# Landing page walkthrough using rodney.
#
# Prerequisites:
#   npm run build && ./scripts/start-debug.sh   (leaves app on port 9222)
#
# Usage:
#   ./demo/rodney-demo/demo.sh
set -euo pipefail

# Wrap uvx rodney so it reads like a normal command throughout the script.
rodney() { uvx rodney "$@"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LANDING_URL="file://${PROJECT_ROOT}/dist/renderer/landing/landing.html?fontSize=medium"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="/tmp/rodney-demo-${TS}"
mkdir -p "${OUT_DIR}"

FAIL=0
check() {
    if ! "$@"; then
        echo "  ✗  FAIL: $*"
        FAIL=1
        return 1
    fi
}

echo ""
echo "── rodney demo: landing page ──"
echo ""

# --- connect to running Electron instance ---
rodney connect localhost:9222

# --- navigate ---
rodney open "${LANDING_URL}"
rodney waitstable

# --- mode buttons: present and enabled ---
for ID in btn-swipe btn-qc btn-locate btn-ai-chat btn-version; do
    if check rodney exists "#${ID}" && check rodney assert "document.querySelector('#${ID}').disabled" 'false'; then
        echo "  ✓  #${ID} present and enabled"
    fi
done

# --- font-size controls: visible ---
for ID in btn-font-small btn-font-medium btn-font-large; do
    if check rodney visible "#${ID}"; then
        echo "  ✓  #${ID} visible"
    fi
done

# --- screenshot: landing ---
rodney screenshot "${OUT_DIR}/01-landing.png"
echo ""
echo "  📸  ${OUT_DIR}/01-landing.png"
echo ""

# --- version dialog ---
rodney click "#btn-version"
rodney wait "#version-dialog"
VERSION="$(rodney text '#version-text')"
if check [ -n "${VERSION}" ]; then
    echo "  ✓  version dialog open — \"${VERSION}\""
fi

rodney screenshot "${OUT_DIR}/02-version-dialog.png"
echo "  📸  ${OUT_DIR}/02-version-dialog.png"
echo ""

rodney click "#version-dialog-close"
echo "  ✓  version dialog closed"

# --- result ---
echo ""
if [ "${FAIL}" -ne 0 ]; then
    echo "RESULT: FAIL"
    exit 1
fi
echo "RESULT: PASS"
echo ""
