#!/usr/bin/env bash
# Builds the app and launches Electron with CDP remote debugging on :9222.
# Use this when an agent (or developer) needs browser-tools to connect to the
# renderer — DOM inspection, screenshots, JS eval, click injection, etc.
#
# Usage:
#   ./scripts/start-debug.sh
#
# Then point browser-tools at the running renderer:
#   browser-eval.js 'document.title'
#   browser-screenshot.js
set -euo pipefail

PORT="${DEBUG_PORT:-9222}"

echo "Building..."
npm run build

echo "Launching Electron with remote debugging on :${PORT} ..."
exec node_modules/.bin/electron --remote-debugging-port="${PORT}" dist/main.js
