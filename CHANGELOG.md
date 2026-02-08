# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Locate reads mode: BAM + read ID file to BED conversion with region filtering, overwrite confirmation, and results display ([`bfe3e25`](https://github.com/sathish-t/nanalogue-gui/commit/bfe3e25c74966bfe9425c998f4cafc50a07706f3))
- Locate reads button on landing page ([`e260085`](https://github.com/sathish-t/nanalogue-gui/commit/e26008584dab6adcd4af4b3340bc398c494ab749))
- Locate reads renderer page with BAM peek, read ID count, region filter, and BED generation ([`4378f0b`](https://github.com/sathish-t/nanalogue-gui/commit/4378f0b1ee24f86e5ec9fcddc2be989d99a1e114))
- Reusable `<output-file-input>` custom element for output file selection with overwrite confirmation ([`66d9dd4`](https://github.com/sathish-t/nanalogue-gui/commit/66d9dd4d8103b3c18bc36a3044857f861deed6d8))
- `locate-data-loader` module for parsing read ID files and generating BED lines ([`26bb243`](https://github.com/sathish-t/nanalogue-gui/commit/26bb243d35c3c455b7e861745182d313dee897de))
- `countNonEmptyLines` streaming line counter for text files ([`9e2f5d6`](https://github.com/sathish-t/nanalogue-gui/commit/9e2f5d6c7d9abf01d05b8db0def3a214376cb0bb))
- Download button for per-read whole-read density data with filter-aware labeling ([`aeb5c1a`](https://github.com/sathish-t/nanalogue-gui/commit/aeb5c1ad31c6a43b81ec9415b1ca7fda2296ef56))
- TSV download IPC handler with path validation, overwrite confirmation, and stream error handling ([`a22a20f`](https://github.com/sathish-t/nanalogue-gui/commit/a22a20f2be32c6008572e2a837fd50af7a81a8ab))
- Per-read density TSV generation during QC analysis ([`5ccf5a9`](https://github.com/sathish-t/nanalogue-gui/commit/5ccf5a93727bddd6fba007d4e344188f626b204e))
- `writeTsvFile` utility for batch TSV file writing ([`dd5fa4d`](https://github.com/sathish-t/nanalogue-gui/commit/dd5fa4dc1d140ed2420ce690ed087bc953b06c0f))

### Changed
- Swipe config uses `<output-file-input>` element instead of inline output file handling ([`790f345`](https://github.com/sathish-t/nanalogue-gui/commit/790f3456a7cfc8265cf25b1b0eefd3dcb449aa45))
- Parallelizes QC data retrieval for read info, modifications, and windowed densities ([`f213a0b`](https://github.com/sathish-t/nanalogue-gui/commit/f213a0b2d41c134653a26ea961fb4480a7e8f8b4))
- Narrows region to annotation bounds in swipe mode ([`cd3f9c6`](https://github.com/sathish-t/nanalogue-gui/commit/cd3f9c667eade39a0a1fcb18fc69ac5e68b2003f))
- Renames data loaders by mode for clarity ([`84ea2d1`](https://github.com/sathish-t/nanalogue-gui/commit/84ea2d1a184945df9e91d2f8705376ee4891088a))
- QCData type uses top-level import type instead of inline imports ([`7800f4d`](https://github.com/sathish-t/nanalogue-gui/commit/7800f4d450e0309483783240f554d921cd6a83a1))
- Dedicated jsdom tests for the `<bam-resource-input>` custom element covering DOM structure, state, mode switching, and events ([`313b587`](https://github.com/sathish-t/nanalogue-gui/commit/313b587183feec08dc538259fc50299c5adec4f4))
- Reusable `<mod-filter-input>` custom element extracting duplicated modification filter UI from QC and Swipe config pages, with 29 jsdom tests ([`44b87ec`](https://github.com/sathish-t/nanalogue-gui/commit/44b87ece1de6d8d373b41c43d66a8ff0b3f74208))
- Reusable `<bam-resource-input>` Custom Element for BAM file/URL source selection, with file/URL radio toggle, Browse button, and `bam-selected`/`source-type-changed` events ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6))
- URL support for BAM source in Swipe config, matching existing QC behavior ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6))
- `treatAsUrl` threaded through Swipe backend pipeline — `SwipeArgs`, `loadContigSizes`, and `loadPlotData` now support remote BAM URLs ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6))
- Mod region field in QC config — optional sub-region to restrict modification filtering, with format and overlap validation against the main region ([`8e3cedd`](https://github.com/sathish-t/nanalogue-gui/commit/8e3cedd))
- Full-region checkbox in QC config — restricts analysis to reads that fully span the specified region ([`35f3b83`](https://github.com/sathish-t/nanalogue-gui/commit/35f3b83))
- Region validation in QC config — parses and validates genomic region strings against BAM header contigs before generation ([`7a333d9`](https://github.com/sathish-t/nanalogue-gui/commit/7a333d9))
- Input validation for flanking region in Swipe config — rejects non-integers, fractions, and negative values with an alert dialog ([`44a55c6`](https://github.com/sathish-t/nanalogue-gui/commit/44a55c6))
- Shared `format-utils` module with formatting and histogram-trimming functions extracted from renderer pages ([`c3919eb`](https://github.com/sathish-t/nanalogue-gui/commit/c3919ebb755282e3fe106eac94881a6f2c5bd038))
- Unit tests for `maxReadLengthForBinWidth` covering all bin-width tiers ([`dabdcb1`](https://github.com/sathish-t/nanalogue-gui/commit/dabdcb1084b8ab643b2af99b75fb25ee59fcf50c))
- jsdom test suites for landing, qc-results, swipe-config, and swipe HTML templates ([`4f33b1d`](https://github.com/sathish-t/nanalogue-gui/commit/4f33b1df3c05bb9c67e10f18581fd01f02d1330e))
- Shared `parseModFilter` module extracted from QC config for reuse across modes ([`f996a1e`](https://github.com/sathish-t/nanalogue-gui/commit/f996a1e))
- Mod filter validation and auto-populate in QC config — field is now required ([`f255285`](https://github.com/sathish-t/nanalogue-gui/commit/f255285))
- `LoadPlotDataOptions` for passing mod tag, strand, and region expansion to data-loader ([`eeefbe1`](https://github.com/sathish-t/nanalogue-gui/commit/eeefbe1))
- "More info" BAM details dialog in Swipe config with contig table and modifications list ([`ca16a9d`](https://github.com/sathish-t/nanalogue-gui/commit/ca16a9d))
- Mod filter, flanking region, and annotation highlight toggle in Swipe config ([`4dd4fde`](https://github.com/sathish-t/nanalogue-gui/commit/4dd4fde))
- "Very coarse" (10 kb) read length bin width option ([`6fbfa22`](https://github.com/sathish-t/nanalogue-gui/commit/6fbfa22))
- "More info" dialog showing full BAM file details — contig table with lengths and
  detected modifications list ([`dd769ac`](https://github.com/sathish-t/nanalogue-gui/commit/dd769ac))
- Custom label formatting on read length histogram using K/M suffixes
  ([`afb8a0c`](https://github.com/sathish-t/nanalogue-gui/commit/afb8a0c))
- jsdom test suite for `qc-config.html` template structure and default form state
  ([`fce13eb`](https://github.com/sathish-t/nanalogue-gui/commit/fce13eb))
- Vitest test framework (v4.0.18) with `npm run test` and `npm run test:watch`
- Unit tests for all library modules: bed-parser, data-loader, histogram, qc-loader, stats
- `RunningHistogram` streaming accumulator class (`src/lib/histogram.ts`) that bins values
  on the fly with running statistics, avoiding raw array storage
- Configurable read length histogram resolution in QC mode (1 / 10 / 100 / 1000 bp)
- Probability range filter in QC results (toggle, low/high bounds, apply)
- Yield summary panel in QC results showing Total Yield and N50
- "No data" placeholder messages when histogram data is empty
- Exceeded-reads warning banner when reads overflow the histogram range
- Error/empty state page in QC results with "Back to config" button
- Input validation for QC config: sample fraction, window size, read length bin width
- Stale-request guard for BAM peek to discard out-of-order responses
- Swipe configuration page with file browsing, BAM peek summary, BED line count,
  output overwrite confirmation, and same-file input/output validation
- Streaming BED line counter (`line-counter.ts`) with tests
- `isBedHeaderLine()` for `track`/`browser` header detection, with tests
- Range filters on whole-read and windowed density histograms in QC results
- Output file path shown on swipe completion screen
- Same-file guard preventing output from overwriting input BED
- Output file overwrite confirmation dialog in swipe mode
- Initialization guard in swipe mode to prevent actions before data loads
- Clamp warning banner in swipe mode when annotation coordinates exceed contig bounds
- `clampWarning` field on `PlotData` type
- `chartjs-plugin-annotation` dependency (^3.1.0) for annotation region highlighting
- `LaunchResult` return type for mode launch IPC handlers with error alerts on landing page

### Changed
- QC and Swipe config pages refactored to use `<bam-resource-input>` Custom Element, replacing inline BAM source HTML and JS ([`a9defd6`](https://github.com/sathish-t/nanalogue-gui/commit/a9defd6))
- `SwipeCliArgs` renamed to `SwipeArgs` and JSDoc updated to reflect GUI-only usage ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d6428))
- README updated to remove CLI usage examples; added Usage section with `npm start` ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d6428))
- QC loader refactored from raw array accumulation to four streaming `RunningHistogram`
  instances, significantly reducing memory usage for large BAM files
- Raw arrays (`readLengths`, `wholeReadDensities`, `windowedDensities`, `rawProbabilities`)
  removed from `QCData` type; replaced with pre-binned histogram and stats fields
- `readLengthBinWidth` and `exceededReadLengths` added to `QCData` and `QCConfig` types
- Probability normalization uses `Math.min(prob / 255, 1 - Number.EPSILON)` clamping so
  raw 255 maps into last bin [0.99, 1.00) instead of overflowing
- `binHistogram` and `binYield` use iterative min/max instead of `Math.min(...spread)` to
  prevent stack overflow on large arrays (200K+ elements)
- `parseWindowedDensities` upgraded from `!isNaN` to `Number.isFinite` (catches Infinity)
- QC navigation handlers (`qc-go-back`, `qc-go-back-to-config`) moved from `modes/qc.ts`
  to `main.ts` to use the centralized `resizeAndLoadMode` helper
- `innerHTML` assignments replaced with DOM element creation in QC config to prevent XSS
- Stats panel toggle moved from inline `onclick` to `addEventListener`
- Adaptive label formatting on histograms: auto-detect decimal places from bin width;
  yield labels use K/M suffixes for finer resolutions
- Generate button disabled during QC generation to prevent double-submit
- Swipe launch refactored from sequential native dialogs to config page
- `setupProbabilityFilter` generalized to `setupHistogramFilter` for reuse
- Histogram/yield charts trim leading/trailing zero-count bins
- Chart animations disabled for faster rendering
- QC config wording: "forward strand" → "basecalled strand"
- Sample fraction warning text updated
- Repository URL corrected from `DNAReplicationLab` to `sathish-t` in README
- `parseWindowReadsTsv` and `parseWindowedDensities` exported for testability

### Removed
- CLI entry point (`bin/nanalogue-gui.js`) and `"bin"` field from `package.json` — the application is now GUI-only ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d6428))
- `parseCliArgs` from `main.ts` and `parseSwipeArgs` from `modes/swipe.ts` — app always launches to the landing page ([`f0d6428`](https://github.com/sathish-t/nanalogue-gui/commit/f0d6428))

### Fixed
- BED parser now validates `0 <= start < end` for coordinates (previously accepted
  negative, zero-width, and reversed intervals)
- `parseWindowReadsTsv` now rejects zero-width windows, negative-start rows, and
  non-finite values
- `loadPlotData` skips records with missing `mod_table` instead of crashing
- `loadPlotData` clamps annotation end to contig size instead of requesting out-of-bounds
- `binHistogram` and `binYield` return empty array for zero or negative bin size instead
  of infinite loop
- `--win` CLI flag now reports an error when no value follows

### Security
- Removed `'unsafe-inline'` from `script-src` in Content Security Policy on all four
  HTML pages (landing, qc-config, qc-results, swipe)

### Dependencies
- Added: `chartjs-plugin-annotation` ^3.1.0, `jsdom` ^26.1.0, `vitest` ^4.0.18
- Updated: `@biomejs/biome` ^2.3.13 → ^2.3.14, `electron` ^40.1.0 → ^40.2.1,
  `esbuild` ^0.27.2 → ^0.27.3

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
