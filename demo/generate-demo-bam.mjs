// Generates demo BAM, FASTA, and BED files for screenshot automation.
// Run with: node demo/generate-demo-bam.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateModBam, readInfo } from '@nanalogue/node';
import seedrandom from 'seedrandom';

const dir = dirname(fileURLToPath(import.meta.url));

// QC demo BAM (small contigs, mixed read types)
const qcConfig = await readFile(resolve(dir, 'demo-bam-config.json'), 'utf-8');
await simulateModBam({
    jsonConfig: qcConfig,
    bamPath: resolve(dir, 'demo.bam'),
    fastaPath: resolve(dir, 'demo.fasta'),
});
console.log('Generated demo.bam and demo.fasta');

// Swipe demo BAM (longer contigs, windowed mod patterns)
const swipeConfig = await readFile(resolve(dir, 'swipe-bam-config.json'), 'utf-8');
await simulateModBam({
    jsonConfig: swipeConfig,
    bamPath: resolve(dir, 'swipe.bam'),
    fastaPath: resolve(dir, 'swipe.fasta'),
});
console.log('Generated swipe.bam and swipe.fasta');

// Generate swipe.bed by picking 10 seeded-random reads from swipe.bam
const swipeBamPath = resolve(dir, 'swipe.bam');
const reads = await readInfo({ bamPath: swipeBamPath });
const mapped = reads.filter((r) => r.alignment_type !== 'unmapped');
const rng = seedrandom('67890');
// Fisher-Yates shuffle for deterministic ordering across JS engines
for (let i = mapped.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mapped[i], mapped[j]] = [mapped[j], mapped[i]];
}
const selected = mapped.slice(0, 10);
const bedLines = selected.map(
    (r) => `${r.contig}\t${r.reference_start}\t${r.reference_end}\t${r.read_id}`
);
await writeFile(resolve(dir, 'swipe.bed'), bedLines.join('\n') + '\n');
console.log('Generated swipe.bed (10 random reads)');
