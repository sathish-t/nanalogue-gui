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
| `qc-data-loader.ts` | `qc-data-loader.test.ts` | A | Uses simulated BAM |
| `swipe-data-loader.ts` | `swipe-data-loader.test.ts` | A | |
| `locate-data-loader.ts` | `locate-data-loader.test.ts` | A | |
| `chat-orchestrator.ts` | `chat-orchestrator.test.ts` | A | Mocked LLM responses in `tests/fixtures/` |
| `chat-session.ts` | `chat-session.test.ts` | A | |
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
| `qc.ts` | none | D | No unit tests; logic is relatively thin IPC glue |
| `swipe.ts` | none | D | No unit tests |

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
| `shared/output-file-input.ts` | none | C | No tests |
| `locate/locate-config.ts` | none | C | No tests |
| `shared/apply-font-size.ts` | none | C | Simple DOM mutation; low risk |

---

## `src/` — Entry points

| Module | Tests | Grade | Notes |
|---|---|---|---|
| `cli.ts` | `cli.test.ts` | B | Major CLI paths covered |
| `execute-cli.ts` | none | C | No dedicated tests; sandbox path covered by `monty-sandbox.test.ts` |
| `main.ts` | none | C | Electron main process — hard to unit-test; covered by E2E |
| `preload.ts` | none | C | Electron preload — contextBridge IPC bridge; hard to unit-test |
| `exit-watchdog.ts` | none | C | Forked child process; hard to unit-test |
| `font-size.ts` | none | C | Simple state; low risk |

---

## Known structural gaps

| Gap | Impact | Status |
|---|---|---|
| No structural lint for import-layer rules | Agent could import `electron` in `lib/` and CI would pass | Open |
| No E2E test suite wired into CI | Electron UI not automatically tested | Open — `demo/playwright.config.mjs` exists but is not part of `npm test` |
| Integration tests require live API keys | `model-listing.integration.test.ts` is skipped in CI | By design |
