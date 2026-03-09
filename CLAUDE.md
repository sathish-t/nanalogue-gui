# CLAUDE.md / AGENTS.md — Repository Map & Agent Instructions

This file is the entry point for all coding agents working on this repository.
`CLAUDE.md` is the canonical source; `AGENTS.md` is a symbolic link to it.

---

## What this project is

`nanalogue-gui` is an Electron desktop application (plus CLI tools) for
interactive analysis and curation of single-molecule BAM files,
focusing on DNA/RNA base modifications (analogues, methylation, etc.).

→ Full product context: [`documentation/for_agents/PRODUCT_SENSE.md`](documentation/for_agents/PRODUCT_SENSE.md)
→ Per-module quality grades and known debt: [`documentation/for_agents/QUALITY.md`](documentation/for_agents/QUALITY.md)

---

## Architecture in one paragraph

The app is split into an **Electron main process** (Node.js, can use native
addons) and several **renderer processes** (browser context, no Node.js).
They communicate over IPC via a thin **preload bridge**. Business logic lives
in `src/lib/` (pure, no Electron) and `src/modes/` (IPC handlers, uses
Electron). Two standalone **CLIs** (`cli.ts`, `execute-cli.ts`) reuse
`src/lib/` without any Electron dependency.

→ Full layer diagram and dependency rules: [`ARCHITECTURE.md`](ARCHITECTURE.md)
→ Code explainers: [`documentation/code-explainers/`](documentation/code-explainers/)

---

## File map

→ Auto-generated, always up to date: [`documentation/script-tree.md`](documentation/script-tree.md)

---

## Key external dependencies

| Package | What it is | Reference |
|---|---|---|
| `@nanalogue/node` | Rust-backed native addon; reads BAM/Mod-BAM files | [`documentation/references/nanalogue-node-api.md`](documentation/references/nanalogue-node-api.md) |
| `@pydantic/monty` | Embedded Python interpreter for the AI Chat sandbox | [`documentation/references/monty-api.md`](documentation/references/monty-api.md) |
| `electron` | Desktop app shell; only used in main process and preload | Electron docs |
| `chart.js` | Charts in renderer processes | chart.js docs |

---

## The AI Chat feature

The most complex feature. The LLM generates Python code; a sandboxed
interpreter runs it; results feed back to the LLM in an agentic loop.

→ Deep dive: [`documentation/ai-chat.md`](documentation/ai-chat.md)
→ Options for AI chat: [`documentation/advanced-options.md`](documentation/advanced-options.md)

---

## Before you finish any task

Run these in order:

```bash
npm run build          # must succeed
npx tsc --noEmit       # must produce no errors
npm run test           # all tests must pass
npm run lint           # no lint errors
npm run lint:fix       # auto-fix what can be fixed
```

Then run both ai reviews (redirect each to a temp file to avoid
interleaved output; use `mktemp` so concurrent runs never collide).
Give each a timeout of 300s.

```bash
CR_OUT=$(mktemp) && CODEX_OUT=$(mktemp)
coderabbit review --prompt-only -t uncommitted > "$CR_OUT" 2>&1
codex review --uncommitted > "$CODEX_OUT" 2>&1
echo "== coderabbit review =="
cat "$CR_OUT"
echo "== codex review =="
cat "$CODEX_OUT"
rm "$CR_OUT" "$CODEX_OUT"
```

Incorporate any suggestions that are worth doing, then repeat the cycle
until neither tool raises new issues (or the remaining issues are not
worth addressing). Do not run multiple `codex review` instances in
parallel — deal with its previous output first.

---

## Testing

For detailed guidance on running tests, coverage enforcement, mocking
patterns, and UI verification (smoke tests, Playwright, Rodney, Showboat),
see [`documentation/testing.md`](documentation/testing.md).

---

## HTML and CSS

Every HTML block and every CSS block must have a comment above it,
consistent with the style used throughout the existing files in this
repository.

---

## Commit messages

First line must be **< 50 characters** and must start with a present-tense
third-person verb: `adds`, `fixes`, `extracts`, `removes`, `updates`, etc.
Not `add`, `fix`, `extract` — think "this commit **adds** …".

---

## Releasing

- Tag prefix: `v` (e.g. `v0.2.5`). Release title: no prefix (e.g. `0.2.5`).
- Ensure `package.json` version matches the release before tagging.
- GitHub repository: `sathish-t/nanalogue-gui` (not `DNAReplicationLab`).

---

## Conventions

- **TypeScript strict mode** — no `any` unless unavoidable; prefer explicit types.
- **No Electron in `lib/`** — pure Node.js or browser-compatible only.
- **No DOM or browser globals in `lib/` or `modes/`** — renderer only.
- **No Node.js built-ins in `renderer/`** — browser context only.
- **Every HTML/CSS block must have a comment above it** (see existing files).
- **Brainstorms and plans** go in `brainstorming/` — never commit that directory.
- **Do not edit `documentation/`** unless explicitly instructed.
