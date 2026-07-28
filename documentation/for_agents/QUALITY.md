# Quality Grades

Per-module quality assessment. Grades are: **A** (well-tested + documented),
**B** (tested, minor gaps), **C** (some tests, notable gaps), **D** (sparse
tests or significant known debt).

**Coverage tracking:** Line coverage is measured and enforced via
`scripts/check-coverage.mjs`. Coverage floors are stored in
`documentation/script-coverage.tsv` — pre-existing tracked files must not
regress, and any file newly observed in coverage output must debut at 100%.
The check runs in CI and in pre-commit when staged TypeScript files under
`src/` are present. This ensures measured quality improvements do not backslide.

Update this file when tests are added, debt is resolved, or new modules
are created.

---

## `src/lib/` — Business logic

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `stats.ts` | `stats.test.ts` | A | N50, percentiles, histogram binning — thorough |
| `histogram.ts` | `histogram.test.ts` | A | RunningHistogram — thorough |
| `format-utils.ts` | `format-utils.test.ts` | A | Formatting helpers |
| `line-counter.ts` | `line-counter.test.ts` | A | |
| `mod-filter.ts` | `mod-filter.test.ts` | A | |
| `region-parser.ts` | `region-parser.test.ts` | A | |
| `bed-parser.ts` | `bed-parser.test.ts` | A | |
| `qc-data-loader.ts` | `qc-data-loader.test.ts`, `qc-data-loader-async.test.ts` | A | Pure helpers + async functions (`peekBam`, `generateQCData`, paginators, `fetchSeqTable`) covered via mocked `@nanalogue/node`; 93.56% line coverage |
| `qc-config-builder.ts` | `qc-config-builder.test.ts` | A | Canonical QC config construction and validation paths; 100% line coverage |
| `swipe-data-loader.ts` | `swipe-data-loader.test.ts`, `swipe-data-loader-async.test.ts` | A | Pure helpers + async functions (`loadContigSizes`, `loadPlotData`) covered via mocked `@nanalogue/node`; 100% line coverage |
| `swipe-contract.ts` | `swipe-contract.test.ts` | A | Swipe request validation and normalization; 100% line coverage |
| `locate-data-loader.ts` | `locate-data-loader.test.ts` | A | |
| `chat-orchestrator.ts` | `chat-orchestrator.test.ts`, `chat-orchestrator-handle-message-*.test.ts`, `cross-endpoint.test.ts` | A | Mocked LLM responses in `tests/fixtures/`; split handle-message suites cover multi-round, recovery, dump-command, and prompt-option paths; 98.68% line coverage |
| `chat-orchestrator-execution.ts` | `chat-orchestrator-split-modules.test.ts`, handle-message suites | A | Sandbox locking, feedback truncation, and terminal overflow; 100% line coverage |
| `chat-orchestrator-facts.ts` | handle-message suites | A | Runtime fact collection; 100% line coverage |
| `chat-orchestrator-helpers.ts` | `chat-orchestrator-helpers.test.ts`, handle-message suites | A | Dump commands and orchestration helpers; 100% line coverage |
| `chat-orchestrator-history.ts` | handle-message suites | A | Conversation-history preparation; 100% line coverage |
| `chat-orchestrator-llm.ts` | `chat-orchestrator-split-modules.test.ts`, `cross-endpoint.test.ts` | A | Provider requests, retry paths, and token estimates; 100% line coverage |
| `chat-session.ts` | `chat-session.test.ts` | A | Includes error paths: generic errors, TimeoutError by name and message, non-Error rejections |
| `monty-sandbox.ts` | `monty-sandbox.test.ts`, `monty-sandbox-helpers.test.ts`, `monty-sandbox-deny-list.test.ts` | A | Three test files; deny-list coverage is thorough |
| `monty-sandbox-helpers.ts` | `monty-sandbox-helpers.test.ts`, `monty-sandbox.test.ts` | A | Dedicated helper tests plus sandbox integration; 99.34% line coverage |
| `model-listing.ts` | `model-listing.test.ts` (+ integration) | A | Provider integration cases run only when their corresponding live keys are present |
| `ai-chat-constants.ts` | `ai-chat-constants.test.ts` | A | |
| `ai-chat-ipc-validation.ts` | `ai-chat-ipc-validation.test.ts` | A | |
| `ipc-path-validation.ts` | `ipc-path-validation.test.ts` | A | Local read/write path, symlink, control-character, and remote URL validation; 100% line coverage |
| `system-append.ts` | `system-append.test.ts` | A | |
| `sandbox-prompt.ts` | `sandbox-prompt.test.ts`, also via `chat-orchestrator.test.ts` | A | Dedicated test file + indirect coverage; 100% coverage |
| `sandbox-prompt-text.ts` | via `sandbox-prompt.test.ts` | A | Prompt text exercised through the prompt builder; 100% line coverage |
| `chat-types.ts` | n/a | A | Types-only, no tests needed |
| `types.ts` | n/a | A | Types-only |
| `histogram-renderer.ts` | `histogram-renderer.test.ts` | A | 100% line coverage |
| `xy-renderer.ts` | `xy-renderer.test.ts` | A | 100% line coverage |
| `log-to-html.ts` | `log-to-html.test.ts` | A | 100% line coverage |
| `log-to-html-assets.ts` | via `log-to-html.test.ts` | A | Embedded report assets exercised through HTML generation; 100% line coverage |
| `ai-chat-shared-constants.ts` | via `ai-chat-constants.test.ts` | B | Constants tested indirectly |
| `sandbox-cli-args.ts` | `sandbox-cli-args.test.ts`, `cli.test.ts` | A | Dedicated parser tests plus CLI coverage; 100% line coverage |

---

## `src/lib/ai-external-tools/` — Sandbox external functions

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `index.ts` | via `ai-external-tools.test.ts` | A | 100% line coverage |
| `bam-mods.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `bash.ts` | `bash.test.ts` | A | 100% line coverage |
| `continue-thinking.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `ls.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `minimap2.ts` | `minimap2.test.ts` | A | 100% line coverage |
| `peek.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `plot-histogram.ts` | `plot-histogram.test.ts` | A | 100% line coverage |
| `plot-series.ts` | `plot-series.test.ts` | A | 100% line coverage |
| `plot-utils.ts` | via `plot-histogram.test.ts`, `plot-series.test.ts` | A | 100% line coverage |
| `read-file.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `read-info.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `seq-table.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `window-reads.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |
| `write-file.ts` | via `monty-sandbox.test.ts` | A | 100% line coverage |

---

## `src/modes/` — IPC handlers

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `ai-chat.ts` | `modes/ai-chat.test.ts` | B | Core IPC and directory-picker dialog paths tested with mocked Electron and chat dependencies; 97.05% line coverage |
| `qc.ts` | `modes/qc.test.ts` | B | Core IPC paths tested; Electron dialog flows covered; 100% line coverage |
| `swipe.ts` | `modes/swipe.test.ts` | B | initialize(), IPC handlers, printSummary, overwrite-dialog flow, and exhausted-annotation path covered; 100% line coverage |
| `locate.ts` | `modes/locate.test.ts` | B | IPC registration, validation, dialog, counting, filtering, and BED generation paths covered; 100% line coverage |

---

## `src/renderer/` — Browser UI

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `landing/landing.ts` | `landing.test.ts` (HTML only), landing smoke test | C | HTML structure and landing navigation flow covered; renderer behavior has no direct unit coverage |
| `ai-chat/ai-chat.ts` | `ai-chat/ai-chat.test.ts` | B | Main chat flow has 83.26% line coverage; provider demo flows require live keys |
| `ai-chat/ai-chat-config.ts` | `ai-chat-config.test.ts` | A | Config bounds, defaults, parsing, locking, and validation; 100% line coverage |
| `ai-chat/ai-chat-consent.ts` | `ai-chat-consent.test.ts` | A | Accept, cancel, and dismiss paths; 100% line coverage |
| `ai-chat/ai-chat-ui.ts` | `ai-chat-ui.test.ts` | A | Code paging, endpoint status, model filtering, messages, and spinner state; 100% line coverage |
| `ai-chat/ai-chat-elements.ts` | via AI Chat renderer tests | B | DOM lookup contract covered indirectly; 100% line coverage |
| `ai-chat/ai-chat-types.ts` | n/a | A | Types-only, no tests needed |
| `qc/qc-config.ts` | `qc-config.test.ts` (HTML only) | D | Template defaults covered, but renderer event, validation, and async behavior are not; QC smoke bypasses the form handlers |
| `qc/qc-results.ts` | `qc-results.test.ts` (HTML only), QC smoke test | C | Entry point executes in the end-to-end chart flow; no direct unit coverage |
| `qc/qc-results-charts.ts` | QC smoke test | C | Core chart rendering executes end-to-end; no direct unit coverage |
| `qc/qc-results-filters.ts` | QC smoke test | C | Loaded by the end-to-end flow, but filter interaction has no direct unit coverage |
| `qc/qc-results-page.ts` | QC smoke test | C | Page initialization and tab rendering execute end-to-end; no direct unit coverage |
| `qc/qc-results-seq-table.ts` | QC smoke test | C | Sequence rendering executes end-to-end; selection and clipboard behavior have no direct unit coverage |
| `qc/qc-results-stats.ts` | QC smoke test | C | Stats rendering executes end-to-end; no direct unit coverage |
| `qc/qc-results-types.ts` | n/a | A | Types-only, no tests needed |
| `qc/seq-mini-charts.ts` | `seq-mini-charts.test.ts` | A | Chart rendering and edge cases; 100% line coverage |
| `swipe/swipe-config.ts` | `swipe-config.test.ts` (HTML only) | D | Template defaults covered, but renderer event and validation behavior are not; Swipe smoke bypasses the form handlers |
| `swipe/swipe.ts` | `swipe.test.ts` | B | Navigation, accept/reject workflow |
| `shared/bam-resource-input.ts` | `bam-resource-input.test.ts` | B | 100% line coverage |
| `shared/mod-filter-input.ts` | `mod-filter-input.test.ts` | B | 100% line coverage |
| `shared/window-size-input.ts` | `window-size-input.test.ts` | B | 100% line coverage |
| `shared/chart-font-size.ts` | `chart-font-size.test.ts` | A | 100% line coverage |
| `shared/output-file-input.ts` | `output-file-input.test.ts` | B | DOM structure, state, events, overwrite flow; 98.68% line coverage |
| `locate/locate-config.ts` | `locate-config.test.ts` (HTML only), Rodney Locate flow | C | Template defaults and a real Electron/IPC BED-generation flow are covered; no direct renderer unit coverage |
| `shared/apply-font-size.ts` | covered indirectly | B | 100% line coverage; no dedicated test file but fully covered via other renderer tests |

---

## `src/` — Entry points

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `cli.ts` | `cli.test.ts` | B | Major CLI paths covered; moderate coverage |
| `execute-cli.ts` | `execute-cli.test.ts` | B | Flag validation, silent/print/truncate/error paths; moderate coverage |
| `main.ts` | none | B | Electron main process — hard to unit-test; CI launches it across landing, Swipe, QC, Locate, and key-gated AI Chat flows |
| `preload.ts` | `preload.test.ts` | A | IPC invoke-routing suite covering every exposed channel and argument; 100% line coverage |
| `exit-watchdog.ts` | none | C | Forked child process; hard to unit-test |
| `font-size.ts` | none | C | Simple state; low risk |

---

## Coverage floor enforcement

The file `documentation/script-coverage.tsv` tracks `%Lines` for TypeScript
files emitted by the Vitest V8 coverage run. Files that are not loaded during
that run do not appear in the ledger. This is not a snapshot — it is an
enforced contract for tracked files:

- **Pre-existing files:** must not regress below their current coverage. If a
  change causes coverage to drop, the pre-commit hook and CI job will fail.
- **Newly covered files:** must debut at 100% coverage. A source file that the
  test run never loads is not detected by this mechanism.
- **Tracked files missing from coverage:** fail the check while the source file
  still exists; deleted source files are retired from the ledger.

After a successful run, current values replace the stored values, so improved
coverage permanently raises the relevant floors.

The enforcement is implemented in `scripts/check-coverage.mjs`, which runs:
- In pre-commit when at least one TypeScript file under `src/` is staged
- In the main-branch CI workflow for pushes and pull requests, except
  Dependabot pull requests

This ensures quality improvements do not backslide and makes coverage trends
visible in commit history.

---

## Known structural gaps

| Gap | Impact | Status |
|---|---|---|
| No structural lint for import-layer rules | Agent could import `electron` in `lib/` and CI would pass | Resolved — `no-restricted-imports` rules in `eslint.config.mjs` |
| Uneven Electron E2E coverage | QC and Swipe smoke flows bypass configuration form handlers; AI Chat provider flows skip when their live API key is unavailable | Partial — `smoke.yml` covers landing, Swipe, and QC; `rodney.yml` covers Locate through real IPC; `demo.yml` exercises configured AI providers when keys are available |
| Integration tests require live API keys | Provider cases in `model-listing.integration.test.ts` skip when their corresponding key is absent; Linux CI supplies configured repository secrets, while keyless runs skip them | By design |
| No coverage enforcement | Quality improvements could regress | Resolved — `scripts/check-coverage.mjs` enforces coverage floors stored in `documentation/script-coverage.tsv`, wired into pre-commit and CI |
| Several renderer modules are not loaded by unit tests | HTML-template tests can pass while QC, Locate, Swipe config, or landing runtime behavior regresses | Open — partially mitigated by landing/QC/Swipe smoke flows and the Rodney Locate flow, but QC and Swipe form handlers remain unexercised |
