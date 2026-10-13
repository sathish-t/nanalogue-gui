#!/usr/bin/env bash

# Shell-level tests for pre-commit Node 22/npm toolchain selection.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d)"
COMMAND_LOG="$TEST_DIR/commands.log"
ORIGINAL_PATH="$PATH"
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir -p "$TEST_DIR/bin"
cat > "$TEST_DIR/bin/npx" <<'EOF'
#!/usr/bin/env bash
printf 'npx %s\n' "$*" >> "$COMMAND_LOG"
EOF
chmod +x "$TEST_DIR/bin/npx"

# No nvm: the portable fallback supplies both pinned Node and npm packages.
(
  unset -f nvm 2>/dev/null || true
  export COMMAND_LOG
  export PATH="$TEST_DIR/bin:$ORIGINAL_PATH"
  # shellcheck source=node-22-npm.sh
  . "$HOOK_DIR/node-22-npm.sh"
  run_node_22_lockfile_install
)
grep -Fq 'node@22.20.0' "$COMMAND_LOG"
grep -Fq 'npm@11.19.0' "$COMMAND_LOG"

# nvm without Node 22: the same portable fallback is used.
: > "$COMMAND_LOG"
(
  nvm() {
    if [ "$1" = "which" ]; then return 1; fi
    return 0
  }
  export COMMAND_LOG
  export PATH="$TEST_DIR/bin:$ORIGINAL_PATH"
  # shellcheck source=node-22-npm.sh
  . "$HOOK_DIR/node-22-npm.sh"
  run_node_22_lockfile_install
)
grep -Fq 'node@22.20.0' "$COMMAND_LOG"
grep -Fq 'npm@11.19.0' "$COMMAND_LOG"

# nvm with Node 22: execute under that Node while still pinning npm 11.
: > "$COMMAND_LOG"
(
  nvm() {
    if [ "$1" = "which" ]; then return 0; fi
    if [ "$1" = "exec" ]; then
      shift
      printf 'nvm exec %s\n' "$*" >> "$COMMAND_LOG"
      return 0
    fi
    return 1
  }
  export COMMAND_LOG
  export PATH="$TEST_DIR/bin:$ORIGINAL_PATH"
  # shellcheck source=node-22-npm.sh
  . "$HOOK_DIR/node-22-npm.sh"
  run_node_22_lockfile_install
)
grep -Fq 'nvm exec 22 npx --yes --package npm@11.19.0 npm install --package-lock-only --ignore-scripts' "$COMMAND_LOG"
if grep -Fq 'node@22.20.0' "$COMMAND_LOG"; then
  echo "nvm Node 22 case unexpectedly used the portable Node package" >&2
  exit 1
fi

echo "Node 22/npm toolchain selection tests passed."
