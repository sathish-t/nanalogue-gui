# Product Sense

This document gives the domain background and product context that agents
need to make good feature and copy decisions in `nanalogue-gui`.

---

## Domain background

**Nanopore/PacBio/or some other system** is a DNA/RNA sequencing technology that reads
single molecules in real time. Unlike short-read sequencing, it produces
long reads (thousands to hundreds of thousands of base pairs) and can detect
chemical modifications directly on the DNA/RNA strand — without separate
assays.

**Base modifications** (analogues and methylation) are the primary subject
of this tool:
- **Analogues** — synthetic bases incorporated into DNA during replication
  (e.g., BrdU, EdU). Used to track replication timing and fork movement.
- **Methylation** — naturally occurring epigenetic marks (e.g., 5mC, 6mA).
  Used to study gene regulation and DNA repair.

A **Mod-BAM** (modified BAM) file is a standard BAM file extended with
`MM`/`ML` tags that encode per-base modification probabilities. This is the
primary input format for all modes in this app.

**Modification probability** is a value from 0–255 (stored in the BAM) or
0.0–1.0 (normalised). A high value means the base is likely modified.

**Modification density** (a.k.a. analogue density) is the fraction of bases
in a window that exceed a probability threshold. This is the main derived
metric used in visualisation and curation.

---

## Target user

A **biologist** working on:
- DNA replication dynamics (tracking analogue incorporation along individual reads)
- Epigenetics (mapping methylation across a genome)
- Single-molecule data curation (accepting/rejecting features annotated by
  upstream tools)

They may or may not be comfortable with the command line, but they understand genomic coordinate
systems and principles of analysis. They may have Python/bash scripting skills.
But, it is also possible they don't have much computational experience.
They are **not** necessarily JavaScript or TypeScript developers.

---

## Modes and their purposes

| Mode | Problem it solves |
|---|---|
| **QC** | "How good is my BAM file?" — read lengths, yield, modification distribution |
| **Swipe** | "Which of these annotated features look real?" — accept/reject each BED entry by eyeballing its mod signal |
| **Locate Reads** | "Where do these reads map?" — converts a list of read IDs to a BED file |
| **AI Chat** | "Ask natural-language questions about BAM data" — LLM writes Python, sandbox executes it |

---

## What "good" looks like

- **Correctness over cleverness.** Users are making scientific decisions.
  A wrong number is worse than no number. Validate inputs, fail loudly
  on bad data, never silently truncate in a way the user can't detect.
- **Transparency.** Users should be able to see what the LLM sent/received
  (dump commands), what filters are active, what limits are in place.
  The AI Chat sandbox is intentionally inspectable.
- **Performance proportional to data size.** BAM files can be gigabytes.
  Record limits, sample fractions, and region filters must be exposed to the
  user so they can trade off completeness vs. speed.
- **Provider-agnostic AI Chat.** AI Chat works with any OpenAI-compatible
  endpoint. Do not hardcode provider-specific behaviour unless absolutely
  necessary; when you must (e.g., `max_tokens` vs `max_completion_tokens`),
  document it explicitly.
- **Security is best-effort, not hardened.** The Monty sandbox prevents
  accidental file access outside the allowed directory. It is not a
  security boundary against a determined adversary. Do not over-claim.

---

## Non-goals

- Real-time streaming data from the sequencer.
- Basecalling (handled by upstream tools).
- Multi-user or cloud-hosted operation.
- Windows native binary (WSL is the recommended path for Windows users).

---

## Conventions that come from domain knowledge

- Region strings use samtools format: `chrI:1000-50000`. Parse them with
  `lib/region-parser.ts`.
- Modification filter strings use `+T`, `-m`, `+a` format (strand prefix +
  modification code). Parse them with `lib/mod-filter.ts`.
- BED files must have at least four tab-separated columns:
  contig, start, end, read_id. Additional columns are preserved and shown
  in the Swipe info strip. The fourth column could be the name of single-molecule
  reads or names of features like genes; this depends on the context.
  In Swipe, the fourth column is always read_id.
- Output BED files from Locate Reads are BED6:
  contig, start, end, read_id, score (a number or '.'), strand.
