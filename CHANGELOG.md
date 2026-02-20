# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Bumps `ai` to ^6.0.94 ([`fe4bbac`](https://github.com/sathish-t/nanalogue-gui/commit/fe4bbac))
- Bumps `@electron/windows-sign` to ^2.0.2 ([`bf229ac`](https://github.com/sathish-t/nanalogue-gui/commit/bf229ac))
- Bumps `typescript-eslint` to ^8.56.0 ([`105c0f1`](https://github.com/sathish-t/nanalogue-gui/commit/105c0f1))
- Bumps `eslint-plugin-jsdoc` to ^62.6.1 ([`a2b95b9`](https://github.com/sathish-t/nanalogue-gui/commit/a2b95b9))

### Infrastructure

- Bumps GitHub Actions `upload-artifact` to v6 and `download-artifact` to v7 ([`b7f795d`](https://github.com/sathish-t/nanalogue-gui/commit/b7f795d92ff3537cb3785101aa3fe65041b068b9))
- Adds Codecov coverage workflow for test coverage reporting ([`2118d4f`](https://github.com/sathish-t/nanalogue-gui/commit/2118d4f7036ad1aa8cd8f58718b3aa76c79f0d9b), [`e333ddb`](https://github.com/sathish-t/nanalogue-gui/commit/e333ddbd19f8f2f254344f1861e06e742122ecb8))
- Adds Codecov config to exclude demo/ from coverage ([`259b6a6`](https://github.com/sathish-t/nanalogue-gui/commit/259b6a673c4c21b91b51e52c4f275efe6b3c2554))
- Demo BAM generation script and Playwright screenshot automation for QC and Swipe modes ([`3e9f102`](https://github.com/sathish-t/nanalogue-gui/commit/3e9f102a0692b37fc30b07233a0caa4412a844cc), [`9d6d6b8`](https://github.com/sathish-t/nanalogue-gui/commit/9d6d6b82fd0d9412f837acf7ef9dfc06f977ff1f))
- CI workflow for demo data generation and screenshot capture ([`7139a1c`](https://github.com/sathish-t/nanalogue-gui/commit/7139a1c717742f88644a062ee6396ab51d5f6e30))
- Pre-commit hook for package-lock.json sync ([`37601a2`](https://github.com/sathish-t/nanalogue-gui/commit/37601a23de8b4dd973749037a31ee89f97d465b5))
- Bumps GitHub Actions `actions/setup-node` to v6 and `actions/checkout` to v6 ([`320da88`](https://github.com/sathish-t/nanalogue-gui/commit/320da88), [`a22ca61`](https://github.com/sathish-t/nanalogue-gui/commit/a22ca61))
- Fixes Electron launch in CI screenshot workflow ([`b046876`](https://github.com/sathish-t/nanalogue-gui/commit/b046876))
- Adds AI Chat screenshot test to demo automation ([`421d5a5`](https://github.com/sathish-t/nanalogue-gui/commit/421d5a5))
- Refreshes README with screenshots, AI Chat docs, CRAM support, and binary install instructions ([`c7362cc`](https://github.com/sathish-t/nanalogue-gui/commit/c7362cc))

### Removed

- Per-read whole-read density TSV download button and backing functionality from QC results, including `writeTsvFile` utility, `filterAndWriteTsv` stream filter, `download-qc-reads` IPC handler, temp directory lifecycle, and preload bridge ([`bf10174`](https://github.com/sathish-t/nanalogue-gui/commit/bf1017471dcad04099e1b85f4e6c68b9dda05862), [`da9dd59`](https://github.com/sathish-t/nanalogue-gui/commit/da9dd593adf62ea256f3489ee51dbf32e3d6a83e), [`c495608`](https://github.com/sathish-t/nanalogue-gui/commit/c4956083efd5fa3de8aade7917acc617c0575b63))

## [0.1.2] - 2026-02-09

### Added

**Locate reads feature:** New mode for converting BAM files + read ID file to BED format with region filtering, overwrite confirmation, and results display. Includes landing page button, dedicated renderer page with BAM peek and read ID count, `locate-data-loader` module for parsing and BED generation, and `countNonEmptyLines` streaming line counter utility. ([`e260085`](https://github.com/sathish-t/nanalogue-gui/commit/e26008584dab6adcd4af4b3340bc398c494ab749), [`4378f0b`](https://github.com/sathish-t/nanalogue-gui/commit/4378f0b1ee24f86e5ec9fcddc2be989d99a1e114), [`26bb243`](https://github.com/sathish-t/nanalogue-gui/commit/26bb243d35c3c455b7e861745182d313dee897de), [`9e2f5d6`](https://github.com/sathish-t/nanalogue-gui/commit/9e2f5d6c7d9abf01d05b8db0def3a214376cb0bb))

**TSV download capability:** Export per-read whole-read density data from QC analysis with filter-aware labeling. Includes download button in results UI, IPC handler with path validation and overwrite confirmation, per-read density TSV generation during analysis, and `writeTsvFile` utility for batch file writing. ([`aeb5c1a`](https://github.com/sathish-t/nanalogue-gui/commit/aeb5c1ad31c6a43b81ec9415b1ca7fda2296ef56), [`a22a20f`](https://github.com/sathish-t/nanalogue-gui/commit/a22a20f2be32c6008572e2a837fd50af7a81a8ab), [`5ccf5a9`](https://github.com/sathish-t/nanalogue-gui/commit/5ccf5a93727bddd6fba007d4e344188f626b204e), [`dd5fa4d`](https://github.com/sathish-t/nanalogue-gui/commit/dd5fa4dc1d140ed2420ce690ed087bc953b06c0f))

**Reusable custom elements and shared modules:** `<output-file-input>` custom element for output file selection with overwrite confirmation, used across locate and swipe modes. Shared `format-utils` module with formatting and histogram-trimming functions extracted from renderer pages. Shared `parseModFilter` module extracted from QC config for reuse across modes. ([`66d9dd4`](https://github.com/sathish-t/nanalogue-gui/commit/66d9dd4d8103b3c18bc36a3044857f861deed6d8), [`c3919eb`](https://github.com/sathish-t/nanalogue-gui/commit/c3919ebb755282e3fe106eac94881a6f2c5bd038), [`f996a1e`](https://github.com/sathish-t/nanalogue-gui/commit/f996a1ece0eb3becd83a474e30f6d3e8b7330314))

**Swipe configuration page:** Dedicated configuration page with file browsing, BAM peek summary, BED line count, output overwrite confirmation, and same-file input/output validation. ([`a289d30`](https://github.com/sathish-t/nanalogue-gui/commit/a289d30800ed0d9786144ac36f742306c9fcb4fb))

**Vitest test framework (v4.0.18):** `npm run test` and `npm run test:watch` commands with unit tests for all library modules (bed-parser, data-loader, histogram, qc-loader, stats) and jsdom test suites for HTML templates.

**`RunningHistogram` streaming accumulator class:** (`src/lib/histogram.ts`) bins values on the fly with running statistics, avoiding raw array storage and significantly reducing memory usage for large BAM files.

**Histogram features and UI:** Configurable read length histogram resolution in QC mode (1 / 10 / 100 / 1,000 / 10,000 bp), probability range filter in QC results (toggle, low/high bounds, apply), range filters on whole-read and windowed density histograms, yield summary panel showing Total Yield and N50, "no data" placeholder messages when histogram data is empty, exceeded-reads warning banner when reads overflow the histogram range.

**QC results UI:** Error/empty state page with "Back to config" button, "More info" BAM details dialog with contig table and detected modifications list, input validation for QC config (sample fraction, window size, read length bin width), stale-request guard for BAM peek to discard out-of-order responses.

**Swipe mode UI:** Initialization guard to prevent actions before data loads, clamp warning banner when annotation coordinates exceed contig bounds, output file path shown on completion screen, same-file guard preventing output from overwriting input BED, output file overwrite confirmation dialog.

**Streaming utilities and parsers:** Streaming BED line counter (`line-counter.ts`) with tests, `isBedHeaderLine()` for `track`/`browser` header detection.

**Type and dependency additions:** `clampWarning` field on `PlotData` type, `LaunchResult` return type for mode launch IPC handlers with error alerts on landing page, `chartjs-plugin-annotation` dependency (^3.1.0) for annotation region highlighting.

### Changed

**BAM resource input refactoring:** Reusable `<bam-resource-input>` custom element for BAM file/URL source selection with file/URL radio toggle, Browse button, and `bam-selected`/`source-type-changed` events. Includes dedicated jsdom tests covering DOM structure, state, mode switching, and events. URL support for BAM source in Swipe config matching existing QC behavior. `treatAsUrl` threaded through Swipe backend pipeline (`SwipeArgs`, `loadContigSizes`, `loadPlotData`) for remote BAM URLs. QC and Swipe config pages refactored to use this element, replacing inline BAM source HTML and JS. ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6245b778a029c06b2a9bd496c22a21047f), [`313b587`](https://github.com/sathish-t/nanalogue-gui/commit/313b587183feec08dc538259fc50299c5adec4f4), [`790f345`](https://github.com/sathish-t/nanalogue-gui/commit/790f3456a7cfc8265cf25b1b0eefd3dcb449aa45))

**Modification filter refactoring:** Reusable `<mod-filter-input>` custom element extracting duplicated modification filter UI from QC and Swipe config pages (29 jsdom tests). Mod filter validation and auto-populate in QC config with field now required. Mod region field in QC config — optional sub-region to restrict modification filtering with format and overlap validation against main region. ([`44b87ec`](https://github.com/sathish-t/nanalogue-gui/commit/44b87ece1de6d8d373b41c43d66a8ff0b3f74208), [`f255285`](https://github.com/sathish-t/nanalogue-gui/commit/f255285d6417592edfe192cf9aed18a576a3d207), [`8e3cedd`](https://github.com/sathish-t/nanalogue-gui/commit/8e3cedd92f1e13f6f7036053cab2a5bc152394f7))

**QC region validation and full-read filtering:** Region validation in QC config — parses and validates genomic region strings against BAM header contigs before generation. Full-region checkbox restricts analysis to reads that fully span the specified region. ([`7a333d9`](https://github.com/sathish-t/nanalogue-gui/commit/7a333d9457d1dcf6e2ce2eaec4d6f62f19136e92), [`35f3b83`](https://github.com/sathish-t/nanalogue-gui/commit/35f3b832b8abad7bbdab24b3c7394bdf5dafd8dc))

**QC data pipeline optimization:** Parallelizes QC data retrieval for read info, modifications, and windowed densities. QC loader refactored from raw array accumulation to four streaming `RunningHistogram` instances, significantly reducing memory usage for large BAM files. QCData type uses top-level import type instead of inline imports. Raw arrays (`readLengths`, `wholeReadDensities`, `windowedDensities`, `rawProbabilities`) removed from `QCData` type; replaced with pre-binned histogram and stats fields. `readLengthBinWidth` and `exceededReadLengths` added to `QCData` and `QCConfig` types. ([`f213a0b`](https://github.com/sathish-t/nanalogue-gui/commit/f213a0b2d41c134653a26ea961fb4480a7e8f8b4), [`7800f4d`](https://github.com/sathish-t/nanalogue-gui/commit/7800f4d450e0309483783240f554d921cd6a83a1))

**Swipe configuration UI enhancements:** Swipe config uses `<output-file-input>` element instead of inline output file handling. Mod filter, flanking region, and annotation highlight toggle controls in Swipe config. "More info" BAM details dialog in Swipe config with contig table and modifications list. `LoadPlotDataOptions` for passing mod tag, strand, and region expansion to data-loader. Input validation for flanking region rejects non-integers, fractions, and negative values with alert dialog. Narrows region to annotation bounds in swipe mode. ([`790f345`](https://github.com/sathish-t/nanalogue-gui/commit/790f3456a7cfc8265cf25b1b0eefd3dcb449aa45), [`4dd4fde`](https://github.com/sathish-t/nanalogue-gui/commit/4dd4fde16c85e32e8fae8b23ffb94f6d3db3a450), [`ca16a9d`](https://github.com/sathish-t/nanalogue-gui/commit/ca16a9dafd3d9576176710095dccd30c9111cd7a), [`eeefbe1`](https://github.com/sathish-t/nanalogue-gui/commit/eeefbe1205c67fe3d11191a90424a5399cb89c4d), [`44a55c6`](https://github.com/sathish-t/nanalogue-gui/commit/44a55c6ed479fde275c31620b389b00c1beee663), [`cd3f9c6`](https://github.com/sathish-t/nanalogue-gui/commit/cd3f9c667eade39a0a1fcb18fc69ac5e68b2003f))

**Histogram visualization improvements:** Custom label formatting on read length histogram using K/M suffixes with auto-detected decimal places from bin width; yield labels use K/M suffixes for finer resolutions. Histogram/yield charts trim leading/trailing zero-count bins. Chart animations disabled for faster rendering. ([`afb8a0c`](https://github.com/sathish-t/nanalogue-gui/commit/afb8a0cd9ad3d6feec4695e600c5ef13c6d6c446), [`6fbfa22`](https://github.com/sathish-t/nanalogue-gui/commit/6fbfa221854a35244c0ead60957de9ac02ff4c22), [`dd769ac`](https://github.com/sathish-t/nanalogue-gui/commit/dd769ac1f7dd71d6746fc8e38d7d6aaa2f8b01a7))

**Testing infrastructure improvements:** jsdom test suites for landing, qc-results, swipe-config, and swipe HTML templates. jsdom test suite for `qc-config.html` template structure and default form state. Unit tests for `maxReadLengthForBinWidth` covering all bin-width tiers. ([`4f33b1d`](https://github.com/sathish-t/nanalogue-gui/commit/4f33b1df3c05bb9c67e10f18581fd01f02d1330e), [`fce13eb`](https://github.com/sathish-t/nanalogue-gui/commit/fce13eb3f3a3d18f8433ae4a998b549a413c2290), [`dabdcb1`](https://github.com/sathish-t/nanalogue-gui/commit/dabdcb1084b8ab643b2af99b75fb25ee59fcf50c))

**Data validation and normalization:** Probability normalization uses `Math.min(prob / 255, 1 - Number.EPSILON)` clamping so raw 255 maps into last bin [0.99, 1.00) instead of overflowing. `binHistogram` and `binYield` use iterative min/max instead of `Math.min(...spread)` to prevent stack overflow on large arrays (200K+ elements). `parseWindowedDensities` upgraded from `!isNaN` to `Number.isFinite` (catches Infinity).

**Code quality improvements:** Stats panel toggle moved from inline `onclick` to `addEventListener`. QC navigation handlers (`qc-go-back`, `qc-go-back-to-config`) moved from `modes/qc.ts` to `main.ts` to use the centralized `resizeAndLoadMode` helper. Renames data loaders by mode for clarity.

**UI polish:** Generate button disabled during QC generation to prevent double-submit. Swipe launch refactored from sequential native dialogs to config page. `setupProbabilityFilter` generalized to `setupHistogramFilter` for reuse. QC config wording: "forward strand" → "basecalled strand". Sample fraction warning text updated.

**API improvements:** `parseWindowReadsTsv` and `parseWindowedDensities` exported for testability. `SwipeCliArgs` renamed to `SwipeArgs` and JSDoc updated to reflect GUI-only usage.

**Documentation:** Repository URL corrected from `DNAReplicationLab` to `sathish-t` in README. README updated to remove CLI usage examples; added Usage section with `npm start`.

### Removed

**CLI removal:** CLI entry point (`bin/nanalogue-gui.js`) and `"bin"` field from `package.json` — the application is now GUI-only. `parseCliArgs` from `main.ts` and `parseSwipeArgs` from `modes/swipe.ts` — app always launches to the landing page. ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d642898bf222843f3e9307a8485620e4684567))

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
