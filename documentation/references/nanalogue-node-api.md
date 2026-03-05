# `@nanalogue/node` — Codebase Usage Reference

Rust-backed native addon for reading BAM/Mod-BAM files. All functions are
async and return Promises. Import from `@nanalogue/node`.

For exact TypeScript types, read `node_modules/@nanalogue/node/index.d.ts`
directly — that file is the source of truth. This document covers how the
library is used in this codebase and the conventions around it.

---

## Where calls happen

All calls to `@nanalogue/node` must happen in either:
- `src/lib/` — `qc-data-loader.ts`, `swipe-data-loader.ts`,
  `locate-data-loader.ts`, `monty-sandbox.ts`
- `src/modes/` — direct calls not yet abstracted into lib

Never import `@nanalogue/node` in `src/renderer/` or the CLI entry points.
The CLI reuses `src/lib/` which already wraps the native calls.

---

## Functions

**`peek`** — quick summary of a BAM file. Returns the list of contigs (with
lengths) and the modification types present. Cheap to call; use it before
more expensive calls to discover what is in the file.

**`readInfo`** — per-read metadata without modification data. Fast. Used for
QC read-length and yield calculations. Each record is either mapped (includes
contig, reference positions, alignment type, alignment length) or unmapped
(sequence length and alignment type only).

**`bamMods`** — per-read base-modification data. More expensive than
`readInfo`. Each record carries a modification table listing, for each
modified base, the canonical base, strand, modification code, and a list of
per-position tuples of read position, reference position, and probability
(0–255). Both mapped and unmapped records are returned; unmapped ones have no
alignment coordinates.

**`windowReads`** — sliding-window modification density per read. Returns a
JSON string — always parse with `JSON.parse` before use. Accepts
window-specific options (`win`, `step`, `winOp`) plus most of the same
filter fields as `ReadOptions`. Note: `WindowOptions` is a standalone type
in the `.d.ts`; it does not extend `ReadOptions`, though the filter fields
largely overlap.

**`seqTable`** — per-read sequence table with modification highlighting.
Returns a JSON string. Used in the QC Sequences tab.

**`simulateModBam`** — generates a synthetic Mod-BAM from a JSON config and
a FASTA reference. Only used in tests; never exposed to users.

---

## `ReadOptions` — shared filter options

Most functions accept `ReadOptions`. Key fields and their semantics:

| Field | Notes |
|---|---|
| `bamPath` | Local path or URL |
| `treatAsUrl` | Set `true` for HTTP(S) sources |
| `region` | samtools format, e.g. `chr1:1000-2000` |
| `fullRegion` | Only reads fully spanning `region`; can only be set when `region` is also set — enforced via a discriminated union in the TypeScript types |
| `tag` | Modification tag filter, e.g. `T`, `m`, `a` |
| `modStrand` | `"bc"` or `"bc_comp"` |
| `minModQual` | Minimum modification probability (0–255) |
| `rejectModQualNonInclusive` | Reject calls whose probability falls in the open interval (low, high) |
| `minSeqLen` / `minAlignLen` | Minimum sequence or alignment length |
| `readFilter` | Comma-separated alignment types, e.g. `"primary_forward,primary_reverse"` |
| `mapqFilter` | Minimum MAPQ (0–255) |
| `excludeMapqUnavail` | Exclude reads with unavailable MAPQ |
| `readIdSet` | Filter to a specific set of read IDs |
| `sampleFraction` | 0.0–1.0 subsample fraction |
| `sampleSeed` | Seed for deterministic sampling; required for stable pagination |
| `limit` / `offset` | Pagination; `limit` must be > 0 if set |
| `modRegion` | Filter mods so that only positions within a sub-region are retained |
| `trimReadEndsMod` | Trim modification info from read ends (bp) |
| `baseQualFilterMod` | Base quality threshold for modifications |
| `threads` | BAM reader threads |
