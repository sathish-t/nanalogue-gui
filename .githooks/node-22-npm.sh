#!/usr/bin/env bash

# Shared lockfile toolchain selection for the pre-commit hook.

NODE_22_NPX_PACKAGE="node@22.20.0"
PINNED_NPM_NPX_PACKAGE="npm@11.19.0"

# Generates the lockfile with Node 22 and pinned npm whether or not nvm has
# already installed the minimum supported Node major.
run_node_22_lockfile_install() {
  if command -v nvm >/dev/null 2>&1 && nvm which 22 >/dev/null 2>&1; then
    nvm exec 22 npx --yes --package "$PINNED_NPM_NPX_PACKAGE" npm \
      install --package-lock-only --ignore-scripts
  else
    npx --yes --package "$NODE_22_NPX_PACKAGE" \
      --package "$PINNED_NPM_NPX_PACKAGE" -c \
      'npm install --package-lock-only --ignore-scripts'
  fi
}
