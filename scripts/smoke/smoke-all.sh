#!/usr/bin/env bash
# Runs smoke scripts that launch their own Electron processes and prints a summary.
#
# Usage:
#   ./scripts/smoke/smoke-all.sh              # run all suites
#   ./scripts/smoke/smoke-all.sh landing      # run only landing.mjs
#   ./scripts/smoke/smoke-all.sh swipe qc     # run specific suites
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default to all suites; allow overriding via args
if [ $# -gt 0 ]; then
    SUITES=("$@")
else
    SUITES=(landing swipe qc exit-watchdog)
fi

PASS=0
FAIL=0
FAILED_SUITES=()

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       nanalogue-gui smoke suite     ║"
echo "╚══════════════════════════════════════╝"

for suite in "${SUITES[@]}"; do
    script="$SCRIPTS_DIR/${suite}.mjs"
    if [ ! -f "$script" ]; then
        echo ""
        echo "  ✗  Unknown suite: ${suite} (no file at ${script})"
        FAIL=$((FAIL + 1))
        FAILED_SUITES+=("$suite")
        continue
    fi

    # Run the script; capture exit code without set -e stopping us
    set +e
    node "$script"
    exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        FAILED_SUITES+=("$suite")
    fi
done

echo ""
echo "══════════════════════════════════════════"
echo "  Passed: ${PASS}   Failed: ${FAIL}"
if [ ${#FAILED_SUITES[@]} -gt 0 ]; then
    echo "  Failed suites: ${FAILED_SUITES[*]}"
fi
echo "══════════════════════════════════════════"
echo ""

[ $FAIL -eq 0 ]
