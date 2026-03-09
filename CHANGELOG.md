# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Adds `demo/rodney-demo/locate-bed.sh` — rodney test for the full locate-bed roundtrip; asserts output BED matches `demo/swipe.bed` (columns 1–4, sorted) and saves three 1920×1080 screenshots; README updated to document both scripts ([`8597023`](https://github.com/sathish-t/nanalogue-gui/commit/859702356b4ad89ef90e6a352867ee1499580fcf))
- Moves smoke/Playwright/Rodney/Showboat testing guidance from `CLAUDE.md` into `documentation/testing.md` ([`2c8c63b`](https://github.com/sathish-t/nanalogue-gui/commit/2c8c63bce8cadd93b86365a1d1a849ce6d45d271))
- Adds `demo/rodney-demo/` — a shell script that drives the landing page via [rodney](https://github.com/simonw/rodney) (Chrome DevTools Protocol automation, run with `uvx rodney`): connects to a live Electron debug instance, asserts all mode buttons and font-size controls, exercises the version dialog, and saves screenshots; a companion CI workflow (`.github/workflows/rodney.yml`) runs it on every push and PR ([`daf014f`](https://github.com/sathish-t/nanalogue-gui/commit/daf014f3502a21aec97766465fc0e39c2ca5d525))
- Widened AI chat option bounds across all numeric fields (timeout, record counts, duration, memory, allocations, read size); docs updated ([`3dc605a`](https://github.com/sathish-t/nanalogue-gui/commit/3dc605a08d776307005236d1dc6245748630bb68), [`828f539`](https://github.com/sathish-t/nanalogue-gui/commit/828f5397c1bb43b5c2a720b128058eb1fedf831c))
- CLI numeric flags now report out-of-range errors (with flag name and allowed range) instead of silently clamping; all errors collected before exiting so the user sees every bad flag at once ([`f89fb5b`](https://github.com/sathish-t/nanalogue-gui/commit/f89fb5b36b4ac78028934ffe5edd166a294aae51))
- LLM timeout errors now show "LLM response timed out (i.e. a message from the LLM took too much time to arrive)" in both CLI and GUI instead of a raw `AbortError` string ([`42cc3d0`](https://github.com/sathish-t/nanalogue-gui/commit/42cc3d004fb77862eb2012ea613095e6adac8a54))
- GUI numeric option inputs now get their `min`/`max` from `CONFIG_FIELD_SPECS` at page load via `applyConfigBounds()`, making the spec the single source of truth ([`6965330`](https://github.com/sathish-t/nanalogue-gui/commit/696533071ac08b131cbe12729e391697ac63c82f))
- Refreshed demo screenshots ([`5b19842`](https://github.com/sathish-t/nanalogue-gui/commit/5b19842572825cfc985f34f7e734df23977f5cd8))
- `--rm-tools <t1,t2,...>` flag for `nanalogue-chat`: removes a comma-separated subset of sandbox tools from the Monty execution environment at both parse time (NameError on call) and registration time; requires `--system-prompt` (hard error if used alone, since the default prompt describes all tools); rejects unknown or space-padded names; applied consistently to the normal LLM path and `/exec` direct runs; help text lists valid tool names ([`217379a`](https://github.com/sathish-t/nanalogue-gui/commit/217379a431b68cf7d5f3e339e7dfb364f48c78dd), [`9f52d13`](https://github.com/sathish-t/nanalogue-gui/commit/9f52d1301aa27dd40ea078b90b2dbac00f460775))
- Test refactoring: the 2430-line `chat-orchestrator.test.ts` was split into `chat-orchestrator.test.ts` (pure unit and adversarial tests, ~970 lines) and `chat-orchestrator-handle-message.test.ts` (all `handleUserMessage` end-to-end tests, ~1385 lines); shared mock-server infrastructure was extracted into `chat-orchestrator-test-utils.ts`; the existing size-limit exception is removed and both new test files sit under the default 1500-line ceiling; four new tests were added to cover previously unreachable branches in the shared utility ([`bcf155a`](https://github.com/sathish-t/nanalogue-gui/commit/bcf155ab5bfb8b7ed8af3287ce02ba250d1372c4), [`858f793`](https://github.com/sathish-t/nanalogue-gui/commit/858f79329fa8cb8f47c8cac5a0babf9291fa40d9))
- `--system-prompt <text>` flag for `nanalogue-chat`: replaces the built-in sandbox prompt; rejects empty/whitespace values; `SYSTEM_APPEND.md` and facts still stack on top ([`bb596ce`](https://github.com/sathish-t/nanalogue-gui/commit/bb596ce91cba85f3358a675289ee9f5ca6acddf3), [`fc7cdf7`](https://github.com/sathish-t/nanalogue-gui/commit/fc7cdf7083a665c61441126f8a92399f11d1272b), [`74d029a`](https://github.com/sathish-t/nanalogue-gui/commit/74d029aec9486607d5f102dc25271c7f4546b810))
- Extends test coverage across five modules — adds async tests for `qc-data-loader` and `swipe-data-loader` (mocking `@nanalogue/node`) lifting each from ~40% to 93–98% statement coverage; adds missing-branch tests for the swipe overwrite-dialog flow, exhausted-annotation path, and `appendFileSync` error handling; adds error-path tests for `chat-session`; adds an invoke-routing suite for `preload.ts` covering every exposed IPC channel, lifting it from 14% to 100%; updates `QUALITY.md` to reflect E2E now being wired into CI and to record the improved grades ([`e7462fc`](https://github.com/sathish-t/nanalogue-gui/commit/e7462fc08348a335ff347243fb3586543ad8ad6e), [`b20544a`](https://github.com/sathish-t/nanalogue-gui/commit/b20544a9662e6d37da32bcdc8539cc0dc027758b), [`2f8a6ab`](https://github.com/sathish-t/nanalogue-gui/commit/2f8a6abf24eed95e63a0710ef6a21c640af0ad74), [`5848395`](https://github.com/sathish-t/nanalogue-gui/commit/5848395358686fb29d6fda04df37c007b083c7a4), [`d15f65e`](https://github.com/sathish-t/nanalogue-gui/commit/d15f65e37e5122b49292b8b7d53c157f907e501f), [`c482186`](https://github.com/sathish-t/nanalogue-gui/commit/c482186394a6f37c2b890c4306cf96f63e101378))
- Adds unit tests for previously untested modules: IPC handlers and initialisation logic for `modes/qc.ts` and `modes/swipe.ts`; DOM structure and behaviour for `renderer/shared/output-file-input.ts` and `renderer/locate/locate-config.ts`; flag validation and execution paths for `execute-cli.ts`; and full channel-surface coverage for `preload.ts` ([`74c3891`](https://github.com/sathish-t/nanalogue-gui/commit/74c38914dd38836f3d1a5e2f796df99c0987a183), [`a6d1d75`](https://github.com/sathish-t/nanalogue-gui/commit/a6d1d757fd07d4dc2531268bcca2a1b28214ed1d), [`1cb1ad6`](https://github.com/sathish-t/nanalogue-gui/commit/1cb1ad616dc004c07eb5985d3f3bc3037f634a90))
- Adds `ARCHITECTURE.md` documenting the layer diagram and dependency rules for the codebase ([`4aa9b6b`](https://github.com/sathish-t/nanalogue-gui/commit/4aa9b6b269057626d707ed608ee096d20bc1b9f4))
- Chart tick labels, axis titles, and legend text now scale with the font-size preset chosen on the landing screen; a new `getChartFontSizes()` helper maps the `font-small`/`font-medium`/`font-large` CSS class to explicit Chart.js pixel sizes (small: 10/11/11 px, medium: 12/13/12 px, large: 15/17/16 px), applied to all QC histograms and the swipe scatter plot ([`6d87fc1`](https://github.com/sathish-t/nanalogue-gui/commit/6d87fc1f0dcae34acacadb5ea7f3e18577d0bf6f), [`ed3c986`](https://github.com/sathish-t/nanalogue-gui/commit/ed3c9868eb43a9642d7183f28db5dda9db062892), [`2e8a1d8`](https://github.com/sathish-t/nanalogue-gui/commit/2e8a1d8c2d7d5bc6e6fa07aaab5d0da73b28b7c5))
- Font size tweaker: three A buttons (small / medium / large) in the landing page header scale all text in the app via a `rem` cascade; the choice is remembered for the session but never persisted to disk ([`cb1f3ad`](https://github.com/sathish-t/nanalogue-gui/commit/cb1f3ad7f47870f78cb68649eb8101eba89b52d0), [`97eb32a`](https://github.com/sathish-t/nanalogue-gui/commit/97eb32a147da2487cad26309317d5e67b2b7a27b), [`3444302`](https://github.com/sathish-t/nanalogue-gui/commit/34443029d57d381b11bb9034ab59cde87912a389), [`a8702a1`](https://github.com/sathish-t/nanalogue-gui/commit/a8702a142d8095d48125f36073712d1a7bf3d655))
- `--dump-llm-instructions` flag for `nanalogue-chat`: when used alongside `--non-interactive`, writes the full LLM request payload (system prompt + conversation) to a dated log file in `ai_chat_output/` and prints the path to stderr; errors with exit 1 if passed without `--non-interactive` ([`4e33fbe`](https://github.com/sathish-t/nanalogue-gui/commit/4e33fbe60307672978898e488a333514dd3a61e6), [`c5e53ce`](https://github.com/sathish-t/nanalogue-gui/commit/c5e53cedab9a97ec0102aa98df18d14b4527dee5))
- `--non-interactive <msg>` flag for `nanalogue-chat`: sends a single message to the LLM, prints the response, and exits with no banner or readline — clean for scripting; validates that the message is non-empty and non-whitespace; README documents usage with a `SYSTEM_APPEND.md` example ([`c3b6747`](https://github.com/sathish-t/nanalogue-gui/commit/c3b67477b4d725ae55b788efc2aaeb3f4c94b358))
- Rough token estimate shown in the system prompt dialog: `~N tokens (rough)` appears on the left of the actions bar when the prompt loads, using UTF-8 byte length divided by 4 ([`a3253f1`](https://github.com/sathish-t/nanalogue-gui/commit/a3253f1cb129602d04acb0eff86476e96e974dce))

### Fixed

- `read_info`, `bam_mods`, `window_reads`, and `seq_table` now correctly honour the sandbox record-count cap (`--max-records-read-info` etc.) even when the Python script passes its own `limit` keyword argument that exceeds the cap; previously the script's `limit` bypassed the CLI cap entirely at the Rust layer, causing `enforceRecordLimit` to throw an error rather than silently returning a capped result ([`660de27`](https://github.com/sathish-t/nanalogue-gui/commit/660de275282ad078599adb639290146f7f367c27))

### Infrastructure

- Adds showboat demo notes directory: moves `sandbox-exec-demo.md` and its generated `length_report.txt` artifact into `demo/showboat-notes/` ([`9660c1d`](https://github.com/sathish-t/nanalogue-gui/commit/9660c1de78f65ccd0dcee6ebaef66a7ff0f45c7d))
- Adds `verify-showboat-docs` CI job that re-runs every code block in each markdown file under `demo/showboat-notes/` and diffs against captured output, using `uvx showboat verify` ([`661088a`](https://github.com/sathish-t/nanalogue-gui/commit/661088a516d3b7319679ef385eca53642607e624))
- `scripts/check-external-tools-sync.mjs` cross-checks that the three declarations of external tool names stay in sync: the `EXTERNAL_FUNCTIONS` array in `ai-chat-constants.ts`, the source files under `src/lib/ai-external-tools/`, and the registration object in `monty-sandbox.ts`; names are derived automatically from each source with no hardcoded list; in pre-commit mode reads from the git index so unstaged edits cannot skew the result; `--all` mode reads from disk for CI use; includes a minimum-set guard for four foundational tool names to catch parser failures early ([`cb098af`](https://github.com/sathish-t/nanalogue-gui/commit/cb098afcd2dc31d3db1d9a7b5d871b79e6019943))
- Adds CLI REPL interactive tests (spawns the CLI with piped stdin, verifies `/quit`, `/new`, banner content, and `SYSTEM_APPEND.md` detection) and non-interactive round-trip tests (verifies a user message reaches the sandbox and print output surfaces on stdout) ([`6d5a9c7`](https://github.com/sathish-t/nanalogue-gui/commit/6d5a9c714e8e15c8a50ff4bcc69a12edf33d09b1))
- Adds dedicated `sandbox-prompt.test.ts` replacing indirect coverage of `buildSandboxPrompt` previously exercised only through `chat-orchestrator.test.ts`; covers limit interpolation, external function doc injection, `removedTools` filtering, `renderFactsBlock` JSON output, and `buildSystemPrompt` `SYSTEM_APPEND` assembly ([`7e78c2a`](https://github.com/sathish-t/nanalogue-gui/commit/7e78c2a3b14a1a0049ce8ce1fb5e21bf6a4ee749))
- Adds three pre-commit and CI checks: an ESLint `@typescript-eslint/naming-convention` rule enforcing PascalCase on all type-like names; `scripts/check-file-size.mjs` enforcing an 800-line ceiling on source files and 1500-line ceiling on test files (five pre-existing files grandfathered with individual caps); and `scripts/check-validate-prefix.mjs` enforcing that every exported function in `*-validation.ts` files is named `validate*` ([`1ba5850`](https://github.com/sathish-t/nanalogue-gui/commit/1ba5850ccabff73f22eafdf0f62d54e239b9fbef), [`04ba7a6`](https://github.com/sathish-t/nanalogue-gui/commit/04ba7a6693fc8e728b409b6eba98ea213870e43b), [`2894db6`](https://github.com/sathish-t/nanalogue-gui/commit/2894db6ffc56c7159826ad40ae3b09e28533f493))
- Adds `scripts/check-coverage.mjs` which enforces a %Lines coverage floor stored in `documentation/script-coverage.tsv`: pre-existing tracked files must not regress, and any newly-instrumented file must debut at 100%; wired into the pre-commit hook (fires on `src/` TypeScript changes) and as a dedicated CI job ([`e56b9a3`](https://github.com/sathish-t/nanalogue-gui/commit/e56b9a31f176a6ee1df159de2ff973b8f12c036c), [`dc2e210`](https://github.com/sathish-t/nanalogue-gui/commit/dc2e210aebb94869eea20f7c2e98158fcb53fc53))
- Adds ESLint `no-restricted-imports` rules enforcing import-layer boundaries (`lib/` forbids `electron`; `renderer/` forbids `electron`, native addons, and Node.js built-ins; CLI entry points forbid `electron`); test files excluded ([`062885f`](https://github.com/sathish-t/nanalogue-gui/commit/062885fb3e90945ec572774ed38a28cb338aa5f6))
- Adds Playwright smoke test suite (`scripts/smoke/`) with suites for landing, swipe, and QC modes; `smoke-all.sh` runner; `start-debug.sh` for interactive CDP sessions ([`b3e72ba`](https://github.com/sathish-t/nanalogue-gui/commit/b3e72baa0e4c8c6ccf617d3ad116d2e3ddcbaa0d))
- Adds `smoke` GitHub Actions workflow running the full Playwright suite under `xvfb-run` with screenshot artifact upload ([`2303267`](https://github.com/sathish-t/nanalogue-gui/commit/230326737a406dde46c68ab8c45100e6eb802fed))
- Adds `CLAUDE.md` / `AGENTS.md` agent-instructions entry point and supporting docs: `documentation/for_agents/PRODUCT_SENSE.md` (product overview), `documentation/for_agents/QUALITY.md` (per-module quality grades), and `documentation/references/` API references for `@nanalogue/node` and `@pydantic/monty`; removes `CLAUDE.md` from `.gitignore` so it is tracked ([`a1d81da`](https://github.com/sathish-t/nanalogue-gui/commit/a1d81dacf1ff81836292a8fcbfb3188ba8d3b568), [`361b7db`](https://github.com/sathish-t/nanalogue-gui/commit/361b7db8df8b134feeb1900a81f8b607cb8b933e), [`ba653fa`](https://github.com/sathish-t/nanalogue-gui/commit/ba653fa8e51e12344a7e98f806381a94e7011bbf))
- `scripts/check-md-links.mjs` validates internal markdown links and inline TypeScript file references across all non-gitignored `.md` files; wired into the pre-commit hook (`--cached-only`) and as a dedicated CI job ([`d707449`](https://github.com/sathish-t/nanalogue-gui/commit/d707449c77d85639e883add5530a93b6bf2938ff), [`a86587c`](https://github.com/sathish-t/nanalogue-gui/commit/a86587c34dbd2f49eddfdb64afc4460875a8ed0b), [`343aa04`](https://github.com/sathish-t/nanalogue-gui/commit/343aa0487c1f7f788ed6832cc39e9fbcb1e29ec5))
- `scripts/generate-script-tree.mjs` generates `documentation/script-tree.md` — an auto-annotated file tree of `src/` extracted from each file's first comment line; the pre-commit hook regenerates and stages it whenever any `src/` file is committed ([`696c384`](https://github.com/sathish-t/nanalogue-gui/commit/696c3849b0be4846f706578a5835470d675bc2d1), [`dcc4be7`](https://github.com/sathish-t/nanalogue-gui/commit/dcc4be7007dceab020f066ec7b6134d1948bf0fd))
- `scripts/validate-changelog.mjs` enforces CHANGELOG format rules; runs in the pre-commit hook when `CHANGELOG.md` is staged and as a dedicated CI job ([`38ced9a`](https://github.com/sathish-t/nanalogue-gui/commit/38ced9a0adc966947784afc19b67ef9ad294567b), [`f37cc66`](https://github.com/sathish-t/nanalogue-gui/commit/f37cc6670d2dcecd7618c016331955a9687e7cda))
- `scripts/validate-css-comments.mjs` enforces that every top-level CSS ruleset in `src/` has a comment immediately above it; runs in the pre-commit hook when any `.css` file is staged and as a dedicated CI job ([`8ce75d4`](https://github.com/sathish-t/nanalogue-gui/commit/8ce75d40b8a58594b7bbe3629798457fc292b7cc))

## [0.2.4] - 2026-03-03

### Added

- `SYSTEM_APPEND.md` support: place a file with that name in the BAM directory to append domain-specific instructions to the default system prompt; loaded once per session with a 64 KB size cap, symlink-safe, available in both GUI and CLI; `/dump_system_prompt` includes the appended content; "View System Prompt" uses the session cache mid-session so the preview always matches what the LLM receives ([`df2009a`](https://github.com/sathish-t/nanalogue-gui/commit/df2009a5d622d298dc35fba765b1c0d9ce5b40c4), [`8e525fa`](https://github.com/sathish-t/nanalogue-gui/commit/8e525fad4112cbacc267ffeef25d0a83c9f34a53), [`42ca01c`](https://github.com/sathish-t/nanalogue-gui/commit/42ca01ccbd9f4ebd1a7b47dc5ab6ed038d86b399), [`f9dc42b`](https://github.com/sathish-t/nanalogue-gui/commit/f9dc42b43846e3ac3b0c3dc548ff9a3daa245c94))
- Best-effort blocking of sensitive files (keys, certificates, dotenv, SSH keys, GPG) from `read_file` and `ls`; GUI consent dialog and CLI startup banner show a best-effort notice ([`bbff8ea`](https://github.com/sathish-t/nanalogue-gui/commit/bbff8eaee57363aaf3d1b2c31c37ff3ed9a784e0), [`81f4a06`](https://github.com/sathish-t/nanalogue-gui/commit/81f4a0698bb1f4ffd05d1bb13f5cf199b9281a1a), [`8f81c28`](https://github.com/sathish-t/nanalogue-gui/commit/8f81c28540220ae7d4b837103050b9f2fae46d2c), [`fddf3f5`](https://github.com/sathish-t/nanalogue-gui/commit/fddf3f5524372525a43b8d22888091f98a9d0f04))
- Added explanations of bits of code for interested power users/developers ([`ca5bb09`](https://github.com/sathish-t/nanalogue-gui/commit/ca5bb096364f2588c176abe5f493974dc3448672), [`443a7ce`](https://github.com/sathish-t/nanalogue-gui/commit/443a7ce91beac44bc27718439bdcef597abf31ae), [`510bac1`](https://github.com/sathish-t/nanalogue-gui/commit/510bac18237daf3e7de7ebde368394eab0edd330), [`667dd1e`](https://github.com/sathish-t/nanalogue-gui/commit/667dd1ec675cbfc21fefe8b0442f650f7eed61f9))
- Reference documentation for all AI Chat advanced options (LLM connection settings, sandbox resource limits, data query limits) and `nanalogue-sandbox-exec` flags, with clarifications such as that sandbox allocations count object creations rather than bytes ([`50902ce`](https://github.com/sathish-t/nanalogue-gui/commit/50902ced14be822ac0db4222cb44bf18a86cfdfb))
- `/dump_system_prompt` CLI REPL slash command dumps the static system prompt to a UUID-named file in `ai_chat_output/`, available at any point in the session (even before the first LLM call), mirroring the GUI's "View System Prompt" button ([`672e6bf`](https://github.com/sathish-t/nanalogue-gui/commit/672e6bffcba7f5ee698c9ba2367ddb8fa25c311f), [`0e55ad7`](https://github.com/sathish-t/nanalogue-gui/commit/0e55ad79c711d2e84e12363bbc9e3e89188b421e))
- "View System Prompt" button in the AI Chat config panel opens a dialog showing the static initial prompt sent to the LLM, built from the current Advanced Options config; includes a Copy button and a note indicating whether the preview reflects current or session-locked settings ([`2770e13`](https://github.com/sathish-t/nanalogue-gui/commit/2770e136950e66265f05af085e72c6cecdbe4974), [`a8c5d61`](https://github.com/sathish-t/nanalogue-gui/commit/a8c5d6185cfd8c29740de2d8fc0df3d965e59b80))
- Sandbox `print()` output is now capped at 1 MB per execution (`maxPrintBytes`), truncated at a UTF-8 boundary; a `printsTruncated` flag on the result signals when clipping occurred. In `nanalogue-sandbox-exec` the cap is set to `min(maxOutputBytes, MAX_PRINT_BUFFER_BYTES)` and `printsTruncated` is reflected in exit-code reporting ([`4b9c25f`](https://github.com/sathish-t/nanalogue-gui/commit/4b9c25fa2815959cea9f6a7467747b726ae58236), [`1714241`](https://github.com/sathish-t/nanalogue-gui/commit/1714241d352ff8eb370fc3cf797d66f17d895db4))
- Copy-to-clipboard button in the AI Chat sandbox code panel; button is inline with the ◀ ▶ pagination controls, disabled when no code is available, and shows brief "Copied!" / "Failed" feedback ([`9af60e6`](https://github.com/sathish-t/nanalogue-gui/commit/9af60e69aaee5d02ed1bd361f3a116ff872b9ebb))
- `nanalogue-sandbox-exec` CLI for running Python scripts directly in the Monty sandbox without LLM involvement ([`90763d4`](https://github.com/sathish-t/nanalogue-gui/commit/90763d4ca045c558594098f8327c48c76ded1609))
- End-user documentation for `nanalogue-chat` in README ([`96f2aaa`](https://github.com/sathish-t/nanalogue-gui/commit/96f2aaa96e66bf7a689f41a820387e8cc89b2c91))
- Extra BED fields displayed in swipe info strip ([`8f7a9eb`](https://github.com/sathish-t/nanalogue-gui/commit/8f7a9eb9096261220bde3226c58e6d48c948e322))

### Fixed

- `max_tokens` vs `max_completion_tokens` field now chosen per endpoint: Mistral and chutes.ai use `max_tokens`; all other OpenAI-compatible providers use `max_completion_tokens` ([`5b50815`](https://github.com/sathish-t/nanalogue-gui/commit/5b50815e794e124434149b6ac9676fd0ec308940))
- Temporary files created during tests are now deleted after each test run ([`00f2794`](https://github.com/sathish-t/nanalogue-gui/commit/00f2794ea0b9c8aef8f3a0dfbff16ad3ba4f33e7))

### Changed

- Refreshes all demo screenshots to reflect recent UI changes ([`c258231`](https://github.com/sathish-t/nanalogue-gui/commit/c25823182c6a6df1e953e77e9c7c015b1f221895))
- Demo swipe BED generation now includes score and strand columns; score is 0 or 1 based on read ID prefix, strand is + or - based on alignment direction ([`bdd4934`](https://github.com/sathish-t/nanalogue-gui/commit/bdd4934942f38ce1d166c1eb011a0b73a341084e))
- Sandbox system prompt restructured: `print()` / `continue_thinking()` guidance split into clearly labelled thinking-round vs final-round sections; corrects `seq_table` docs (`region` is required and must be a keyword argument), changes "limited stdlib" to "no stdlib, no imports of any kind", and unifies the hardcoded output-cap mention with the dynamic `maxOutputKB` value ([`6e079d6`](https://github.com/sathish-t/nanalogue-gui/commit/6e079d6abd4c38d1395e05e96118151de2213d5c))
- CLI output now respects the `NO_COLOR` environment variable ([`7ecc829`](https://github.com/sathish-t/nanalogue-gui/commit/7ecc829b68d33d5e2e8ef4822e4e77210987162f))
- `write_file` now writes directly to the allowed directory instead of a fixed `ai_chat_output/` subdirectory; adds symlink-traversal guard via `assertExistingAncestorInside` before `mkdir` ([`83f21df`](https://github.com/sathish-t/nanalogue-gui/commit/83f21df5255f0ff586223be178c561bfbb077daf))
- Updates sandbox system-prompt documentation to reflect new `write_file` path semantics ([`2fb20c3`](https://github.com/sathish-t/nanalogue-gui/commit/2fb20c3e4afe5b4792bdd1c05ef84c07639c1b4b))
- `extractFacts` now detects `write_file` output via `bytes_written` presence and a code-level scan instead of the removed `ai_chat_output/` path prefix ([`a663f6d`](https://github.com/sathish-t/nanalogue-gui/commit/a663f6d12d2b4d3309f4e3bc9679e368c5e38be4))

### Dependencies

- Bumps `@biomejs/biome` to ^2.4.4, `electron` to ^40.6.1, `eslint` to ^10.0.2, `@eslint/js` to ^10.0.1, `eslint-plugin-jsdoc` to ^62.7.1, `html-validate` to ^10.9.0, `stylelint` to ^17.4.0, `typescript-eslint` to ^8.56.1; bumps `actions/upload-artifact` to v7, `actions/download-artifact` to v8

## [0.2.3] - 2026-02-26

### Added

- Configurable `maxReadMB` and `maxWriteMB` sandbox file size limits with CLI flags, validation specs, and settings UI ([`78c6e37`](https://github.com/sathish-t/nanalogue-gui/commit/78c6e376e6189bb807d091955bc25664d73a5db3), [`bc774ad`](https://github.com/sathish-t/nanalogue-gui/commit/bc774ad9c7153cb3e5e8506dcaefc2410b62d690), [`6a0b9e1`](https://github.com/sathish-t/nanalogue-gui/commit/6a0b9e190c8817b15f5d1b9e6bdeec877f8d9124), [`f6d2d43`](https://github.com/sathish-t/nanalogue-gui/commit/f6d2d4368b7ad57c8b4cb9bf7e41ac0a7bfbfa1d), [`e724662`](https://github.com/sathish-t/nanalogue-gui/commit/e724662e5d9bcf1a1dd4c9374c48044f4a9d7e9d))

### Fixed

- Windowed density plot shift ([`3bc17a0`](https://github.com/sathish-t/nanalogue-gui/commit/3bc17a03dd6278a251d35b5ac1038d901cb25f58))

## [0.2.2] - 2026-02-25

### Changed

- Updates README AI Chat section to reflect Python code sandbox approach instead of tool calling ([`b24f008`](https://github.com/sathish-t/nanalogue-gui/commit/b24f00848fcb7ee0b3bf42e08303cf4b9581de6a))
- Parameterizes AI Chat demo screenshots for multiple providers (OpenAI, Google Gemini, Anthropic) with per-provider filenames and artifact upload ([`33c1af1`](https://github.com/sathish-t/nanalogue-gui/commit/33c1af118d39bd33dd98ae1f414f0845f780c472), [`d96388b`](https://github.com/sathish-t/nanalogue-gui/commit/d96388b94dc3b5ffa1dfe58f55cfa635c90392ef), [`a6296f4`](https://github.com/sathish-t/nanalogue-gui/commit/a6296f4ef87ac7a3b391dcf01ec258c0b5ea28b0))
- Extracted reusable `ChatSession` class from AI Chat IPC handlers for shared GUI/CLI use ([`9c02a77`](https://github.com/sathish-t/nanalogue-gui/commit/9c02a77339bf7c79f7ff627567c33cf1b2137bb7))
- Rewrites chat orchestrator from Vercel AI SDK tool-call architecture to a native fetch loop where the LLM responds with Python code executed in the Monty sandbox ([`e57aa9d`](https://github.com/sathish-t/nanalogue-gui/commit/e57aa9d1a8778d4944cdab37589ec1ca938df5b6))

### Added

- Stores the most recent LLM request payload for dump inspection ([`a5a4ec5`](https://github.com/sathish-t/nanalogue-gui/commit/a5a4ec51156f38b2b7f5486e8805b13b600a192d))
- Appends assistant response to lastSentMessages after each LLM call ([`3fba216`](https://github.com/sathish-t/nanalogue-gui/commit/3fba216a8adcf1119f4a06aa3dbc360d73423206))
- `/dump_llm_instructions` slash command to write the last LLM request as plain text to `ai_chat_output/` ([`5034829`](https://github.com/sathish-t/nanalogue-gui/commit/5034829bc91b7c263c5431a77f5463a15b090798), [`18e7bf2`](https://github.com/sathish-t/nanalogue-gui/commit/18e7bf23a17c7111d064d707d08403ccb873bc19))
- Configurable sandbox resource limits: `maxDurationSecs`, `maxMemoryMB`, `maxAllocations` with CLI flags, validation specs, and UI controls ([`2d1218c`](https://github.com/sathish-t/nanalogue-gui/commit/2d1218c3cf89f3a12dd87812571dd9c433c1c6c8), [`49db849`](https://github.com/sathish-t/nanalogue-gui/commit/49db8499029ae36b7d3a756350d0475aadebc628), [`b1fdc4b`](https://github.com/sathish-t/nanalogue-gui/commit/b1fdc4b324f170444755c58ea9d8276d37973c5e))
- `/exec` slash command for running Python files directly without an LLM round-trip ([`fbf9b98`](https://github.com/sathish-t/nanalogue-gui/commit/fbf9b98a6a89210fb9dba2f6642a961c02c46268))
- Unit tests for `ChatSession` covering send, cancel, reset, and stale response detection ([`650e0dc`](https://github.com/sathish-t/nanalogue-gui/commit/650e0dc25eb30761056c716935076fc1c3a8efd1))
- Standalone `nanalogue-chat` CLI for LLM-powered BAM analysis without Electron ([`ec3f7aa`](https://github.com/sathish-t/nanalogue-gui/commit/ec3f7aabebed6ea2246bd42041bebddc4cbc14ec))
- Print capture and `continue_thinking()` external function in Monty sandbox ([`3c3c82d`](https://github.com/sathish-t/nanalogue-gui/commit/3c3c82ded04ed2bff86a6234606b7af2b0eb9239))
- `maxCodeRounds` and `temperature` configuration fields for AI Chat ([`ee664df`](https://github.com/sathish-t/nanalogue-gui/commit/ee664df2964bb1cf21106e9b81108ea1d3fea6d5))
- `--version` / `-v` flag for the CLI that prints the package version and exits ([`ae3e614`](https://github.com/sathish-t/nanalogue-gui/commit/ae3e6146a50053a928f01c80b6f5e0401c54ba62))

### Fixed

- Pre-commit hook now also triggers when only `package-lock.json` is staged, e.g. after `npm audit fix` ([`e97fb89`](https://github.com/sathish-t/nanalogue-gui/commit/e97fb89214a6b9bac47772cf3c05941d06976fbe))

### Removed

- `ai`, `@ai-sdk/openai-compatible`, and `zod` dependencies replaced by native fetch ([`e57aa9d`](https://github.com/sathish-t/nanalogue-gui/commit/e57aa9d1a8778d4944cdab37589ec1ca938df5b6))

### Dependencies

- Bumps `@biomejs/biome` to ^2.4.3, `electron-builder` to ^26.8.1, `electron` to ^40.6.0

## [0.2.0] - 2026-02-20

### Added

- Reusable `<window-size-input>` custom element with inline validation, range enforcement (2–10,000), and `window-size-changed` event ([`3023a1c`](https://github.com/sathish-t/nanalogue-gui/commit/3023a1c8df5566d46034ed6bef509c73e779c635))
- Configurable window size in Swipe mode, replacing the hardcoded 300-base default ([`f66d051`](https://github.com/sathish-t/nanalogue-gui/commit/f66d0517fcb8e97e4ba474b7cbb51fa2965e7435))
- Read type counts (primary/secondary/supplementary/unmapped by strand) in QC results expandable stats panel ([`553b1da`](https://github.com/sathish-t/nanalogue-gui/commit/553b1da5dab409c137f6cb66a51ab40c624a35d2))
- CRAM file support in all file picker dialogs across QC, Swipe, and Locate modes ([`4ef5c70`](https://github.com/sathish-t/nanalogue-gui/commit/4ef5c70c8bf53373442ca584c48a98cdfea85a14))
- AI Chat types, IPC validation, and shared config field specs ([`595c9a3`](https://github.com/sathish-t/nanalogue-gui/commit/595c9a391fd721ab0c42614c0946d6cdf9edd033))
- Monty sandbox wrapper with path traversal guards, output gating, and record limits ([`c24437b`](https://github.com/sathish-t/nanalogue-gui/commit/c24437b13db9b7b6b9fe275b985cf157de10700c))
- Chat orchestrator with sliding window context, facts extraction, and LLM tool-call loop ([`99eb4ee`](https://github.com/sathish-t/nanalogue-gui/commit/99eb4ee1ecbbc9126b0c124597bb046320d5d154))
- AI Chat mode and renderer with config panel, consent flow, and collapsible code display ([`d6b7b29`](https://github.com/sathish-t/nanalogue-gui/commit/d6b7b293ecd08a35d225ce7649775c8ef5b43af1))
- Connection status indicator for AI Chat endpoint showing local/remote, HTTP/HTTPS, and connected state ([`c91002f`](https://github.com/sathish-t/nanalogue-gui/commit/c91002fc1d82d65d09f4f403b54479307adc29d8))
- Multi-provider model listing for AI Chat with IPC handler ([`4418785`](https://github.com/sathish-t/nanalogue-gui/commit/4418785f42f31662da3e345d2f4237969dce5533), [`06065fb`](https://github.com/sathish-t/nanalogue-gui/commit/06065fbca23ebd53cf71593eb52e7a2bcad3cecd))
- Deterministic `sampleSeed` field on QC config and results for reproducible subsampling ([`fc42269`](https://github.com/sathish-t/nanalogue-gui/commit/fc4226937d9dba193956fff95ecb89eb95a72297), [`f901faf`](https://github.com/sathish-t/nanalogue-gui/commit/f901faf4000189c13ecf9d823d6530ae22e72dc7))
- Advanced options UI for QC config: mapping filters (MAPQ, read type), length filters, read ID file picker, modification filters (base quality, trim, probability rejection) ([`383bb7e`](https://github.com/sathish-t/nanalogue-gui/commit/383bb7ef48d1822ac642aada4e0efe0b7e32625c), [`a12b616`](https://github.com/sathish-t/nanalogue-gui/commit/a12b6169e44f42845c211782882cc57ac145d0c6), [`2db3040`](https://github.com/sathish-t/nanalogue-gui/commit/2db3040a26752bc7b10ec4972ee5e24700f84e2a))
- QC loading overlay shows per-source progress counters for reads, modifications, and windows ([`57f35cd`](https://github.com/sathish-t/nanalogue-gui/commit/57f35cd5e3b9e2727d3775f2ca66a89922f0b1d4))
- Stylelint config allows `stylelint-disable/enable` directive comments ([`c494e4a`](https://github.com/sathish-t/nanalogue-gui/commit/c494e4aaa4b5064d6ae1a849a1d3bd1373ac2133))
- SeqTableRow type and QCData fields for sequence table data ([`d8ccfdf`](https://github.com/sathish-t/nanalogue-gui/commit/d8ccfdf829f3580de4f54af47ff28b37c24799b1))
- Sequence table data loader with TSV parsing, average quality computation, and region size gating ([`296e5dd`](https://github.com/sathish-t/nanalogue-gui/commit/296e5dd007dcefecf2abf75a59dae0f966bda342))
- Sequence loading progress and skip-reason display on QC config page ([`7314a8c`](https://github.com/sathish-t/nanalogue-gui/commit/7314a8c77ce378d546ef3e06d48c5ee3ad979215))
- Sequences tab in QC results with per-read modification highlighting, quality tooltips, row selection, and read ID copy ([`d4702e4`](https://github.com/sathish-t/nanalogue-gui/commit/d4702e4067d28f597cd274dc0d1e362594cfa93f))
- Length-based matching utility for pairing tagged and base sequences ([`c4d5337`](https://github.com/sathish-t/nanalogue-gui/commit/c4d53376e34d317aab3d6108a58fa645da0a52d7))
- Multi-alignment TSV parsing for comma-separated sequence rows ([`ff8b276`](https://github.com/sathish-t/nanalogue-gui/commit/ff8b276c6ec4191610550a873a92ec0d73a9fe76))
- Multi-alignment sequence matching with ambiguous-read exclusion ([`64fafbe`](https://github.com/sathish-t/nanalogue-gui/commit/64fafbe0be841fd8fe52b31958142bf3ebee0036))
- Multi-alignment UI: row tinting, deduplicated counts, ambiguous-read warning ([`cf4e170`](https://github.com/sathish-t/nanalogue-gui/commit/cf4e17080f434b25ff56fc36f9cfc6d200370435))
- Exit watchdog child process for force-killing the app on window close, even when the main event loop is blocked by native addon calls ([`ecfa1f5`](https://github.com/sathish-t/nanalogue-gui/commit/ecfa1f5837ae5d51a10dcb8a731c1a8b40150149))
- Version button and dialog on landing page with link to nanalogue.com, external URL opens in OS browser ([`0b0dee6`](https://github.com/sathish-t/nanalogue-gui/commit/0b0dee655f35d7ab2fdb195de7264dbf22c8e8eb))
- Increases IPC validation test coverage with tests for `validateListModels`, `validateSendMessage` field checks, and `validateIpcPayload` channel routing ([`1766072`](https://github.com/sathish-t/nanalogue-gui/commit/1766072f4962201bf5c2ca2d3bfe27ee487fb548), [`4e598b0`](https://github.com/sathish-t/nanalogue-gui/commit/4e598b03f86afcf132e0b72d45be24e403a91cfd), [`87eb133`](https://github.com/sathish-t/nanalogue-gui/commit/87eb133148376bd7b5ec3167e2f014e17c053fc3), [`abadd9e`](https://github.com/sathish-t/nanalogue-gui/commit/abadd9ebe4f5df846da58e426117cd7b1140a6be))
- Increases test coverage for ai-chat-constants, qc-data-loader, and swipe-data-loader with edge case and structural tests ([`0df8a18`](https://github.com/sathish-t/nanalogue-gui/commit/0df8a18dde7f6c6a52aa3965c73001fd354b607d), [`e1a5212`](https://github.com/sathish-t/nanalogue-gui/commit/e1a5212df676b0c201e9edcade1631f13986e633), [`eaafcfd`](https://github.com/sathish-t/nanalogue-gui/commit/eaafcfdda13eca0b16222c5268a710c11292aad6))

### Changed

- Sandbox `window_reads` parses JSON and returns a validated array with `enforceRecordLimit` instead of byte-based string truncation ([`7c70a19`](https://github.com/sathish-t/nanalogue-gui/commit/7c70a191fc24564b1bcd8c0f3e85f54eccaa82ea))
- QC config window size input replaced with `<window-size-input>` custom element ([`8058ddc`](https://github.com/sathish-t/nanalogue-gui/commit/8058ddc1a161f1efa8f47a5e4775312e4337bca6))
- Bumps `@nanalogue/node` to ^0.1.4 and migrates swipe-data-loader and qc-data-loader from TSV to JSON parsing for `windowReads` output ([`e1aecd3`](https://github.com/sathish-t/nanalogue-gui/commit/e1aecd35544a845b8df6145f4e44d15c93dbe00b), [`7ec8f9a`](https://github.com/sathish-t/nanalogue-gui/commit/7ec8f9aea3eeaada48ed52c9846d399368ec30f7), [`0fdc20e`](https://github.com/sathish-t/nanalogue-gui/commit/0fdc20e802cfcb05a61ed4e5435445f1776f796a))
- Merges `paginateReadInfo` into `paginateWindowReads` — read lengths and alignment type counts now come from `windowReads` JSON, eliminating one concurrent API call ([`0fdc20e`](https://github.com/sathish-t/nanalogue-gui/commit/0fdc20e802cfcb05a61ed4e5435445f1776f796a))
- Bumps `@nanalogue/node` to ^0.1.3 ([`2f49f16`](https://github.com/sathish-t/nanalogue-gui/commit/2f49f16c5fd5b99033fcee24b43a4ff12a68cc77))
- Caps BED file parsing at 10k entries ([`ef12920`](https://github.com/sathish-t/nanalogue-gui/commit/ef1292084f853723546a7f04a0f5b46381e3a6d7))
- Caps read ID parsing at 200k IDs ([`3d117f0`](https://github.com/sathish-t/nanalogue-gui/commit/3d117f0a5893943ef05d21853d47cf5ea63afde6))
- QC data loading now paginates in 10k-record pages with streaming histograms to reduce peak memory ([`d385b9e`](https://github.com/sathish-t/nanalogue-gui/commit/d385b9ecf0774135d390f8723858fd03fc4f882c))
- QC pagination stops on partial page instead of requiring an extra empty-page fetch ([`1f2e833`](https://github.com/sathish-t/nanalogue-gui/commit/1f2e8336bbb87b0d16fa2b8f7df4534705e1b7bf))
- QC generation forwards per-source pagination progress to the renderer via `qc-progress` IPC ([`02b8185`](https://github.com/sathish-t/nanalogue-gui/commit/02b8185ae1a3c696c3bc168c6dee84eca14ddd5c))

### Fixed


- Tool calls matched by ID instead of array index in chat orchestrator ([`79a72ff`](https://github.com/sathish-t/nanalogue-gui/commit/79a72ff5d68394ba1b6e852cb6f97c49d069d4f3))
- AI Chat spinner and processing state reset on new chat ([`0036fa3`](https://github.com/sathish-t/nanalogue-gui/commit/0036fa30901a1926227f0e50bd65cb1214e3ea26))
- Ambiguous read detection failed for multi-alignment reads because comma-space separator in seqTable output left leading whitespace, making same-length sequences appear different ([`7ca7f49`](https://github.com/sathish-t/nanalogue-gui/commit/7ca7f4920e327e4ad1bf0418133fb6dee2227201))

### Dependencies

- Added: `ai` ^6.0.86, `@ai-sdk/openai-compatible` ^2.0.30, `@pydantic/monty` ^0.0.5, `picomatch` ^4.0.3 ([`8d7edab`](https://github.com/sathish-t/nanalogue-gui/commit/8d7edabfcd133168eb066144488ca9e0e1a34765))
- Bumps `@pydantic/monty` to ^0.0.7 ([`37601a2`](https://github.com/sathish-t/nanalogue-gui/commit/37601a23de8b4dd973749037a31ee89f97d465b5))
- Added: `@electron/windows-sign` ^1.2.2 dev dependency for electron-builder ([`231bbe6`](https://github.com/sathish-t/nanalogue-gui/commit/231bbe663a837b5ce8d2d508c4e5a548153454ed))
- Added: `@vitest/coverage-v8` dev dependency for code coverage ([`47985fd`](https://github.com/sathish-t/nanalogue-gui/commit/47985fd759000e1e473aba1a56f77b4d24305199))
- Added: `@playwright/test` ^1.58.2, `playwright` ^1.58.2, `seedrandom` ^3.0.5 dev dependencies for demo automation ([`3e9f102`](https://github.com/sathish-t/nanalogue-gui/commit/3e9f102a0692b37fc30b07233a0caa4412a844cc), [`9d6d6b8`](https://github.com/sathish-t/nanalogue-gui/commit/9d6d6b82fd0d9412f837acf7ef9dfc06f977ff1f))
- Bumps `ai` to ^6.0.94 ([`fe4bbac`](https://github.com/sathish-t/nanalogue-gui/commit/fe4bbac73dc404420f2987f843d00ae419e4f1d4))
- Bumps `@electron/windows-sign` to ^2.0.2 ([`bf229ac`](https://github.com/sathish-t/nanalogue-gui/commit/bf229acf917df286118febfdd8a59c19162c4892))
- Bumps `typescript-eslint` to ^8.56.0 ([`105c0f1`](https://github.com/sathish-t/nanalogue-gui/commit/105c0f16522ad16d5612da831cfedebd157433c5))
- Bumps `eslint-plugin-jsdoc` to ^62.6.1 ([`a2b95b9`](https://github.com/sathish-t/nanalogue-gui/commit/a2b95b99db64a302827c170d2e8e93681274060b))

### Infrastructure

- Bumps GitHub Actions `upload-artifact` to v6 and `download-artifact` to v7 ([`b7f795d`](https://github.com/sathish-t/nanalogue-gui/commit/b7f795d92ff3537cb3785101aa3fe65041b068b9))
- Adds Codecov coverage workflow for test coverage reporting ([`2118d4f`](https://github.com/sathish-t/nanalogue-gui/commit/2118d4f7036ad1aa8cd8f58718b3aa76c79f0d9b), [`e333ddb`](https://github.com/sathish-t/nanalogue-gui/commit/e333ddbd19f8f2f254344f1861e06e742122ecb8))
- Adds Codecov config to exclude demo/ from coverage ([`259b6a6`](https://github.com/sathish-t/nanalogue-gui/commit/259b6a673c4c21b91b51e52c4f275efe6b3c2554))
- Demo BAM generation script and Playwright screenshot automation for QC and Swipe modes ([`3e9f102`](https://github.com/sathish-t/nanalogue-gui/commit/3e9f102a0692b37fc30b07233a0caa4412a844cc), [`9d6d6b8`](https://github.com/sathish-t/nanalogue-gui/commit/9d6d6b82fd0d9412f837acf7ef9dfc06f977ff1f))
- CI workflow for demo data generation and screenshot capture ([`7139a1c`](https://github.com/sathish-t/nanalogue-gui/commit/7139a1c717742f88644a062ee6396ab51d5f6e30))
- Pre-commit hook for package-lock.json sync ([`37601a2`](https://github.com/sathish-t/nanalogue-gui/commit/37601a23de8b4dd973749037a31ee89f97d465b5))
- Bumps GitHub Actions `actions/setup-node` to v6 and `actions/checkout` to v6 ([`320da88`](https://github.com/sathish-t/nanalogue-gui/commit/320da88c5d9a3d05d5ea6c00c61c056f6e7d1a0d), [`a22ca61`](https://github.com/sathish-t/nanalogue-gui/commit/a22ca6172bbd31888fb280f9466ca5652878aa49))
- Fixes Electron launch in CI screenshot workflow ([`b046876`](https://github.com/sathish-t/nanalogue-gui/commit/b0468765e1996e8e225843ee0d384e994cf1e022))
- Adds AI Chat screenshot test to demo automation ([`421d5a5`](https://github.com/sathish-t/nanalogue-gui/commit/421d5a514f6b121e4987f71c051530fef251e0f6))
- Refreshes README with screenshots, AI Chat docs, CRAM support, and binary install instructions ([`c7362cc`](https://github.com/sathish-t/nanalogue-gui/commit/c7362ccec9c99588a619b8c0b09368f36c38687c))
- Installs `@pydantic/monty-wasm32-wasi` fallback in release Docker build for aarch64 Linux, where no native monty binding exists ([`8d323c5`](https://github.com/sathish-t/nanalogue-gui/commit/8d323c5c776306d61e8e856badcbef7c431ad489))

### Removed

- Per-read whole-read density TSV download button and backing functionality from QC results, including `writeTsvFile` utility, `filterAndWriteTsv` stream filter, `download-qc-reads` IPC handler, temp directory lifecycle, and preload bridge ([`bf10174`](https://github.com/sathish-t/nanalogue-gui/commit/bf1017471dcad04099e1b85f4e6c68b9dda05862), [`da9dd59`](https://github.com/sathish-t/nanalogue-gui/commit/da9dd593adf62ea256f3489ee51dbf32e3d6a83e), [`c495608`](https://github.com/sathish-t/nanalogue-gui/commit/c4956083efd5fa3de8aade7917acc617c0575b63))

## [0.1.2] - 2026-02-09

### Added

- **Locate reads feature:** New mode for converting BAM files + read ID file to BED format with region filtering, overwrite confirmation, and results display. Includes landing page button, dedicated renderer page with BAM peek and read ID count, `locate-data-loader` module for parsing and BED generation, and `countNonEmptyLines` streaming line counter utility. ([`e260085`](https://github.com/sathish-t/nanalogue-gui/commit/e26008584dab6adcd4af4b3340bc398c494ab749), [`4378f0b`](https://github.com/sathish-t/nanalogue-gui/commit/4378f0b1ee24f86e5ec9fcddc2be989d99a1e114), [`26bb243`](https://github.com/sathish-t/nanalogue-gui/commit/26bb243d35c3c455b7e861745182d313dee897de), [`9e2f5d6`](https://github.com/sathish-t/nanalogue-gui/commit/9e2f5d6c7d9abf01d05b8db0def3a214376cb0bb))
- **TSV download capability:** Export per-read whole-read density data from QC analysis with filter-aware labeling. Includes download button in results UI, IPC handler with path validation and overwrite confirmation, per-read density TSV generation during analysis, and `writeTsvFile` utility for batch file writing. ([`aeb5c1a`](https://github.com/sathish-t/nanalogue-gui/commit/aeb5c1ad31c6a43b81ec9415b1ca7fda2296ef56), [`a22a20f`](https://github.com/sathish-t/nanalogue-gui/commit/a22a20f2be32c6008572e2a837fd50af7a81a8ab), [`5ccf5a9`](https://github.com/sathish-t/nanalogue-gui/commit/5ccf5a93727bddd6fba007d4e344188f626b204e), [`dd5fa4d`](https://github.com/sathish-t/nanalogue-gui/commit/dd5fa4dc1d140ed2420ce690ed087bc953b06c0f))
- **Reusable custom elements and shared modules:** `<output-file-input>` custom element for output file selection with overwrite confirmation, used across locate and swipe modes. Shared `format-utils` module with formatting and histogram-trimming functions extracted from renderer pages. Shared `parseModFilter` module extracted from QC config for reuse across modes. ([`66d9dd4`](https://github.com/sathish-t/nanalogue-gui/commit/66d9dd4d8103b3c18bc36a3044857f861deed6d8), [`c3919eb`](https://github.com/sathish-t/nanalogue-gui/commit/c3919ebb755282e3fe106eac94881a6f2c5bd038), [`f996a1e`](https://github.com/sathish-t/nanalogue-gui/commit/f996a1ece0eb3becd83a474e30f6d3e8b7330314))
- **Swipe configuration page:** Dedicated configuration page with file browsing, BAM peek summary, BED line count, output overwrite confirmation, and same-file input/output validation. ([`a289d30`](https://github.com/sathish-t/nanalogue-gui/commit/a289d30800ed0d9786144ac36f742306c9fcb4fb))
- **Vitest test framework (v4.0.18):** `npm run test` and `npm run test:watch` commands with unit tests for all library modules (bed-parser, data-loader, histogram, qc-loader, stats) and jsdom test suites for HTML templates.
- **`RunningHistogram` streaming accumulator class:** (`src/lib/histogram.ts`) bins values on the fly with running statistics, avoiding raw array storage and significantly reducing memory usage for large BAM files.
- **Histogram features and UI:** Configurable read length histogram resolution in QC mode (1 / 10 / 100 / 1,000 / 10,000 bp), probability range filter in QC results (toggle, low/high bounds, apply), range filters on whole-read and windowed density histograms, yield summary panel showing Total Yield and N50, "no data" placeholder messages when histogram data is empty, exceeded-reads warning banner when reads overflow the histogram range.
- **QC results UI:** Error/empty state page with "Back to config" button, "More info" BAM details dialog with contig table and detected modifications list, input validation for QC config (sample fraction, window size, read length bin width), stale-request guard for BAM peek to discard out-of-order responses.
- **Swipe mode UI:** Initialization guard to prevent actions before data loads, clamp warning banner when annotation coordinates exceed contig bounds, output file path shown on completion screen, same-file guard preventing output from overwriting input BED, output file overwrite confirmation dialog.
- **Streaming utilities and parsers:** Streaming BED line counter (`line-counter.ts`) with tests, `isBedHeaderLine()` for `track`/`browser` header detection.
- **Type and dependency additions:** `clampWarning` field on `PlotData` type, `LaunchResult` return type for mode launch IPC handlers with error alerts on landing page, `chartjs-plugin-annotation` dependency (^3.1.0) for annotation region highlighting.

### Changed

- **BAM resource input refactoring:** Reusable `<bam-resource-input>` custom element for BAM file/URL source selection with file/URL radio toggle, Browse button, and `bam-selected`/`source-type-changed` events. Includes dedicated jsdom tests covering DOM structure, state, mode switching, and events. URL support for BAM source in Swipe config matching existing QC behavior. `treatAsUrl` threaded through Swipe backend pipeline (`SwipeArgs`, `loadContigSizes`, `loadPlotData`) for remote BAM URLs. QC and Swipe config pages refactored to use this element, replacing inline BAM source HTML and JS. ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6245b778a029c06b2a9bd496c22a21047f), [`313b587`](https://github.com/sathish-t/nanalogue-gui/commit/313b587183feec08dc538259fc50299c5adec4f4), [`790f345`](https://github.com/sathish-t/nanalogue-gui/commit/790f3456a7cfc8265cf25b1b0eefd3dcb449aa45))
- **Modification filter refactoring:** Reusable `<mod-filter-input>` custom element extracting duplicated modification filter UI from QC and Swipe config pages (29 jsdom tests). Mod filter validation and auto-populate in QC config with field now required. Mod region field in QC config — optional sub-region to restrict modification filtering with format and overlap validation against main region. ([`44b87ec`](https://github.com/sathish-t/nanalogue-gui/commit/44b87ece1de6d8d373b41c43d66a8ff0b3f74208), [`f255285`](https://github.com/sathish-t/nanalogue-gui/commit/f255285d6417592edfe192cf9aed18a576a3d207), [`8e3cedd`](https://github.com/sathish-t/nanalogue-gui/commit/8e3cedd92f1e13f6f7036053cab2a5bc152394f7))
- **QC region validation and full-read filtering:** Region validation in QC config — parses and validates genomic region strings against BAM header contigs before generation. Full-region checkbox restricts analysis to reads that fully span the specified region. ([`7a333d9`](https://github.com/sathish-t/nanalogue-gui/commit/7a333d9457d1dcf6e2ce2eaec4d6f62f19136e92), [`35f3b83`](https://github.com/sathish-t/nanalogue-gui/commit/35f3b832b8abad7bbdab24b3c7394bdf5dafd8dc))
- **QC data pipeline optimization:** Parallelizes QC data retrieval for read info, modifications, and windowed densities. QC loader refactored from raw array accumulation to four streaming `RunningHistogram` instances, significantly reducing memory usage for large BAM files. QCData type uses top-level import type instead of inline imports. Raw arrays (`readLengths`, `wholeReadDensities`, `windowedDensities`, `rawProbabilities`) removed from `QCData` type; replaced with pre-binned histogram and stats fields. `readLengthBinWidth` and `exceededReadLengths` added to `QCData` and `QCConfig` types. ([`f213a0b`](https://github.com/sathish-t/nanalogue-gui/commit/f213a0b2d41c134653a26ea961fb4480a7e8f8b4), [`7800f4d`](https://github.com/sathish-t/nanalogue-gui/commit/7800f4d450e0309483783240f554d921cd6a83a1))
- **Swipe configuration UI enhancements:** Swipe config uses `<output-file-input>` element instead of inline output file handling. Mod filter, flanking region, and annotation highlight toggle controls in Swipe config. "More info" BAM details dialog in Swipe config with contig table and modifications list. `LoadPlotDataOptions` for passing mod tag, strand, and region expansion to data-loader. Input validation for flanking region rejects non-integers, fractions, and negative values with alert dialog. Narrows region to annotation bounds in swipe mode. ([`790f345`](https://github.com/sathish-t/nanalogue-gui/commit/790f3456a7cfc8265cf25b1b0eefd3dcb449aa45), [`4dd4fde`](https://github.com/sathish-t/nanalogue-gui/commit/4dd4fde16c85e32e8fae8b23ffb94f6d3db3a450), [`ca16a9d`](https://github.com/sathish-t/nanalogue-gui/commit/ca16a9dafd3d9576176710095dccd30c9111cd7a), [`eeefbe1`](https://github.com/sathish-t/nanalogue-gui/commit/eeefbe1205c67fe3d11191a90424a5399cb89c4d), [`44a55c6`](https://github.com/sathish-t/nanalogue-gui/commit/44a55c6ed479fde275c31620b389b00c1beee663), [`cd3f9c6`](https://github.com/sathish-t/nanalogue-gui/commit/cd3f9c667eade39a0a1fcb18fc69ac5e68b2003f))
- **Histogram visualization improvements:** Custom label formatting on read length histogram using K/M suffixes with auto-detected decimal places from bin width; yield labels use K/M suffixes for finer resolutions. Histogram/yield charts trim leading/trailing zero-count bins. Chart animations disabled for faster rendering. ([`afb8a0c`](https://github.com/sathish-t/nanalogue-gui/commit/afb8a0cd9ad3d6feec4695e600c5ef13c6d6c446), [`6fbfa22`](https://github.com/sathish-t/nanalogue-gui/commit/6fbfa221854a35244c0ead60957de9ac02ff4c22), [`dd769ac`](https://github.com/sathish-t/nanalogue-gui/commit/dd769ac1f7dd71d6746fc8e38d7d6aaa2f8b01a7))
- **Testing infrastructure improvements:** jsdom test suites for landing, qc-results, swipe-config, and swipe HTML templates. jsdom test suite for `qc-config.html` template structure and default form state. Unit tests for `maxReadLengthForBinWidth` covering all bin-width tiers. ([`4f33b1d`](https://github.com/sathish-t/nanalogue-gui/commit/4f33b1df3c05bb9c67e10f18581fd01f02d1330e), [`fce13eb`](https://github.com/sathish-t/nanalogue-gui/commit/fce13eb3f3a3d18f8433ae4a998b549a413c2290), [`dabdcb1`](https://github.com/sathish-t/nanalogue-gui/commit/dabdcb1084b8ab643b2af99b75fb25ee59fcf50c))
- **Data validation and normalization:** Probability normalization uses `Math.min(prob / 255, 1 - Number.EPSILON)` clamping so raw 255 maps into last bin [0.99, 1.00) instead of overflowing. `binHistogram` and `binYield` use iterative min/max instead of `Math.min(...spread)` to prevent stack overflow on large arrays (200K+ elements). `parseWindowedDensities` upgraded from `!isNaN` to `Number.isFinite` (catches Infinity).
- **Code quality improvements:** Stats panel toggle moved from inline `onclick` to `addEventListener`. QC navigation handlers (`qc-go-back`, `qc-go-back-to-config`) moved from `modes/qc.ts` to `main.ts` to use the centralized `resizeAndLoadMode` helper. Renames data loaders by mode for clarity.
- **UI polish:** Generate button disabled during QC generation to prevent double-submit. Swipe launch refactored from sequential native dialogs to config page. `setupProbabilityFilter` generalized to `setupHistogramFilter` for reuse. QC config wording: "forward strand" → "basecalled strand". Sample fraction warning text updated.
- **API improvements:** `parseWindowReadsTsv` and `parseWindowedDensities` exported for testability. `SwipeCliArgs` renamed to `SwipeArgs` and JSDoc updated to reflect GUI-only usage.
- **Documentation:** Repository URL corrected from `DNAReplicationLab` to `sathish-t` in README. README updated to remove CLI usage examples; added Usage section with `npm start`.

### Removed

- **CLI removal:** CLI entry point (`bin/nanalogue-gui.js`) and `"bin"` field from `package.json` — the application is now GUI-only. `parseCliArgs` from `main.ts` and `parseSwipeArgs` from `modes/swipe.ts` — app always launches to the landing page. ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d642898bf222843f3e9307a8485620e4684567))

### Fixed

- BED parser now validates `0 <= start < end` for coordinates (previously accepted negative, zero-width, and reversed intervals)
- `parseWindowReadsTsv` now rejects zero-width windows, negative-start rows, and non-finite values
- `loadPlotData` skips records with missing `mod_table` instead of crashing
- `loadPlotData` clamps annotation end to contig size instead of requesting out-of-bounds
- `binHistogram` and `binYield` return empty array for zero or negative bin size instead of infinite loop

### Security

- Removed `'unsafe-inline'` from `script-src` in Content Security Policy on all HTML pages
- `innerHTML` assignments replaced with DOM element creation in QC config to prevent XSS

### Dependencies

- Added: `chartjs-plugin-annotation` ^3.1.0, `jsdom` ^26.1.0, `vitest` ^4.0.18
- Updated: `@biomejs/biome` ^2.3.13 → ^2.3.14, `electron` ^40.1.0 → ^40.2.1, `esbuild` ^0.27.2 → ^0.27.3

### Infrastructure

- `GSETTINGS_BACKEND=memory` replaces `ELECTRON_NO_DCONF=1` for GSettings suppression
- Added `docs/` to `.gitignore`
- Excluded `*.test.ts` from TypeScript compilation in `tsconfig.json`

## [0.1.0] - 2026-02-06

### Added

- Initial release of nanalogue-gui
- Electron application with three modes:
  - Landing page for mode selection
  - Swipe mode for interactive annotation curation (accept/reject workflow)
  - QC mode for quality control analysis of BAM/Mod-BAM files
- CLI interface (`nanalogue-gui [swipe|qc]`)
- Integration with @nanalogue/node for BAM/Mod-BAM analysis
- Chart.js visualizations for QC metrics:
  - Read length histograms
  - Cumulative yield curves
  - Analogue density distributions (whole-read and windowed)
  - Raw modification probability distributions
- Comprehensive linting setup (Biome, ESLint, Stylelint, html-validate)
- TypeScript with strict mode enabled
- GitHub Actions CI/CD:
  - CI workflow with lint, typecheck, and cross-platform build (Ubuntu/macOS)
  - Nightly CI to catch upstream breakage
  - Dependabot for npm and github-actions dependency updates
