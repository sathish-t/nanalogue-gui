# Quality Grades

Per-module quality assessment. Grades are: **A** (well-tested + documented),
**B** (tested, minor gaps), **C** (some tests, notable gaps), **D** (sparse
tests or significant known debt).

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
| `qc-data-loader.ts` | `qc-data-loader.test.ts`, `qc-data-loader-async.test.ts` | A | Pure helpers + async functions (`peekBam`, `generateQCData`, paginators, `fetchSeqTable`) covered via mocked `@nanalogue/node` |
| `swipe-data-loader.ts` | `swipe-data-loader.test.ts`, `swipe-data-loader-async.test.ts` | A | Pure helpers + async functions (`loadContigSizes`, `loadPlotData`) covered via mocked `@nanalogue/node` |
| `locate-data-loader.ts` | `locate-data-loader.test.ts` | A | |
| `chat-orchestrator.ts` | `chat-orchestrator.test.ts` | A | Mocked LLM responses in `tests/fixtures/` |
| `chat-session.ts` | `chat-session.test.ts` | A | Includes error paths: generic errors, TimeoutError by name and message, non-Error rejections |
| `monty-sandbox.ts` | `monty-sandbox.test.ts`, `monty-sandbox-helpers.test.ts`, `monty-sandbox-deny-list.test.ts` | A | Three test files; deny-list coverage is thorough |
| `model-listing.ts` | `model-listing.test.ts` (+ integration) | A | Integration test skipped unless live keys present |
| `ai-chat-constants.ts` | `ai-chat-constants.test.ts` | A | |
| `ai-chat-ipc-validation.ts` | `ai-chat-ipc-validation.test.ts` | A | |
| `system-append.ts` | `system-append.test.ts` | A | |
| `sandbox-prompt.ts` | none | C | No unit tests for prompt template |
| `chat-types.ts` | n/a | A | Types-only, no tests needed |
| `types.ts` | n/a | A | Types-only |
| `ai-chat-shared-constants.ts` | via `ai-chat-constants.test.ts` | B | Constants tested indirectly |
| `sandbox-cli-args.ts` | via `cli.test.ts` | B | Tested indirectly through CLI |

---

## `src/modes/` — IPC handlers

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `ai-chat.ts` | `modes/ai-chat.test.ts` | B | Core IPC paths tested; Electron dialog flows not |
| `qc.ts` | `modes/qc.test.ts` | B | Core IPC paths tested; Electron dialog flows covered |
| `swipe.ts` | `modes/swipe.test.ts` | B | initialize(), IPC handlers, and printSummary covered; overwrite-dialog flow and exhausted-annotation path covered; Electron dialog flows for other cases not tested |

---

## `src/renderer/` — Browser UI

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `landing/landing.ts` | `landing.test.ts` | B | |
| `ai-chat/ai-chat.ts` | `ai-chat/ai-chat.test.ts` | B | |
| `qc/qc-config.ts` | `qc-config.test.ts` | B | |
| `qc/qc-results.ts` | `qc-results.test.ts` | B | |
| `swipe/swipe-config.ts` | `swipe-config.test.ts` | B | |
| `swipe/swipe.ts` | `swipe.test.ts` | B | |
| `shared/bam-resource-input.ts` | `bam-resource-input.test.ts` | B | |
| `shared/mod-filter-input.ts` | `mod-filter-input.test.ts` | B | |
| `shared/window-size-input.ts` | `window-size-input.test.ts` | B | |
| `shared/chart-font-size.ts` | `chart-font-size.test.ts` | A | |
| `shared/output-file-input.ts` | `output-file-input.test.ts` | B | DOM structure, state, events, overwrite flow |
| `locate/locate-config.ts` | `locate-config.test.ts` | B | HTML template structure and default state |
| `shared/apply-font-size.ts` | none | C | Simple DOM mutation; low risk |

---

## `src/` — Entry points

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `cli.ts` | `cli.test.ts` | B | Major CLI paths covered |
| `execute-cli.ts` | `execute-cli.test.ts` | B | Flag validation, silent/print/truncate/error paths |
| `main.ts` | none | B | Electron main process — hard to unit-test; covered by E2E smoke tests wired into CI (`smoke.yml`) |
| `preload.ts` | `preload.test.ts` | A | Every exposed function called and its IPC channel + arguments verified; listener handler invocation and cleanup tested; 100% coverage |
| `exit-watchdog.ts` | none | C | Forked child process; hard to unit-test |
| `font-size.ts` | none | C | Simple state; low risk |

---

## Known structural gaps

| Gap | Impact | Status |
|---|---|---|
| No structural lint for import-layer rules | Agent could import `electron` in `lib/` and CI would pass | Resolved — `no-restricted-imports` rules in `eslint.config.mjs` |
| No E2E test suite wired into CI | Electron UI not automatically tested | Resolved — smoke tests (`scripts/smoke/`) run on every push/PR via `smoke.yml`, covering landing, swipe, and QC modes; AI Chat covered by `demo.yml` |
| Integration tests require live API keys | `model-listing.integration.test.ts` is skipped in CI | By design |
