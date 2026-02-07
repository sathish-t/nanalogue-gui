# `nanalogue-gui`

Electron GUI for Nanalogue: interactive nanopore data analysis and curation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Nanalogue-gui provides a desktop application for working with BAM/Mod-BAM files,
with a focus on single-molecule DNA/RNA modifications. It builds on
[@nanalogue/node](https://github.com/DNAReplicationLab/nanalogue-node) to provide
interactive visualisation and curation workflows.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Modes](#modes)
  - [Swipe](#swipe)
  - [QC](#qc)
- [Development](#development)
- [Versioning](#versioning)
- [Changelog](#changelog)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Requirements

- Node.js 22 or higher

## Installation

```bash
git clone https://github.com/sathish-t/nanalogue-gui.git
cd nanalogue-gui
npm install
```

## Usage

```bash
npm start
```

This launches the landing page where you can choose between Swipe and QC modes.

## Modes

### Swipe

Interactive annotation curation. Displays modification signal plots for each
annotation in a BED file, allowing the user to accept or reject each one.

The configuration screen allows setting:
- BAM file path
- BED annotations file path
- Output file path
- Modification filter (e.g., `+T`, `-m`)
- Flanking region size (base pairs)
- Annotation highlight visibility

Controls:
- **Right arrow** or **Accept button**: accept the annotation
- **Left arrow** or **Reject button**: reject the annotation

### QC

Quality control analysis of BAM/Mod-BAM files. Generates interactive charts
covering read lengths, yield, analogue density, and modification probabilities.

The configuration screen allows setting:
- BAM source (local file or URL)
- Modification filter (e.g., `+T`, `-m`)
- Genomic region (e.g., `chrI:1000-50000`)
- Sample fraction (0.01%--100%)
- Window size (10--10000 bases)

QC result tabs:
- **Read Lengths**: histogram of aligned read lengths
- **Yield Curve**: cumulative yield by read count
- **Analogue Density**: whole-read and windowed density histograms
- **Raw Probability**: modification probability distribution

## Development

```bash
# Build the project
npm run build

# Run in development mode
npm run dev

# Lint (Biome, ESLint, Stylelint, html-validate)
npm run lint

# Auto-fix linting issues
npm run lint:fix

# TypeScript type checking
npx tsc --noEmit
```

## Versioning

We use [Semantic Versioning](https://semver.org/).

**Current Status: Pre-1.0 (0.x.y)**

While in 0.x.y versions:
- The API may change without notice
- Breaking changes can occur in minor version updates

After 1.0.0, we will guarantee backwards compatibility in minor/patch releases.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

This software was developed at the Earlham Institute in the UK.
This work was supported by the Biotechnology and Biological Sciences
Research Council (BBSRC), part of UK Research and Innovation,
through the Core Capability Grant BB/CCG2220/1 at the Earlham Institute
and the Earlham Institute Strategic Programme Grant Cellular Genomics
BBX011070/1 and its constituent work packages BBS/E/ER/230001B
(CellGen WP2 Consequences of somatic genome variation on traits).
The work was also supported by the following response-mode project grants:
BB/W006014/1 (Single molecule detection of DNA replication errors) and
BB/Y00549X/1 (Single molecule analysis of Human DNA replication).
This research was supported in part by NBI Research Computing
through use of the High-Performance Computing system and Isilon storage.
