# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
