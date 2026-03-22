# Shared Renderer Components

All files live in `src/renderer/shared/`.

---

## Custom elements

Four Web Components are registered here and reused across config pages.
Each exposes a typed JS property API and fires bubbling `CustomEvent`s;
parent pages never query internal DOM directly.

**`<bam-resource-input>`** (`bam-resource-input.ts`)  
File/URL radio toggle with a text input and Browse button. Used by
`qc-config`, `swipe-config`, `locate-config`. Events: `bam-selected`,
`source-type-changed`. The `selectFileFn` property must be wired by
the parent to open the native file dialog. A `<mod-filter-input>` accompanies
this element on all current usage pages (see below).

**`<mod-filter-input>`** (`mod-filter-input.ts`)  
Text input for a modification filter string (e.g. `+T`, `-m`). Validates
via `src/lib/mod-filter.ts` and exposes `tag`, `modStrand`, `isValid`.
`showValidation` controls whether the inline hint is visible. Used by
`qc-config`, `swipe-config`. Event: `mod-filter-changed`. The filter is
**required** in all current usages — `isValid` gates the start button.

**`<output-file-input>`** (`output-file-input.ts`)  
Read-only path input with Browse button. Detects existing files via a
pluggable `checkExistsFn` and shows an overwrite warning + confirmation
checkbox when needed. Used by `swipe-config`, `locate-config`. Events:
`output-selected`, `overwrite-confirmed`.

**`<window-size-input>`** (`window-size-input.ts`)  
Number input for a window size (default 300, range 2–10,000, in bases
of interest). Exposes `value` and `isValid`. Used by `qc-config`,
`swipe-config`. Event: `window-size-changed`.

---

## Utility modules

**`apply-font-size.ts`** — `applyFontSize()` reads the `fontSize` URL
param and adds `font-small`/`font-medium`/`font-large` to `<html>`. Call
once at the top of every renderer entry point.

**`chart-font-size.ts`** — `getChartFontSizes()` returns Chart.js pixel
sizes (`tick`, `title`, `legend`) scaled to the active font-size preset.
Call after `applyFontSize()` in any renderer that creates charts.

**`styles.css`** — Base stylesheet linked by every HTML page. Provides
the font-size preset rules, global reset, body defaults, the `#app` flex
container, and swipe-viewer chrome (flash overlay, progress bar,
overlays, etc.) used by the swipe renderer.
