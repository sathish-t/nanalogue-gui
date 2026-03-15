# minimap2: aligning sequences in the sandbox

*2026-03-15T12:43:06Z by Showboat 0.6.1*
<!-- showboat-id: 88954363-bca1-4251-bcf1-fdedce7c3e69 -->

minimap2() is a sandbox external function that runs sequence alignment entirely in-process via a WebAssembly build of minimap2 v2.22 — no native binary is required. It always outputs PAF format. Both input files must be FASTA or FASTQ and must live inside the allowed directory. The demo uses two files: `sample_contigs.fa` (three short reference contigs: dummyI, dummyII, dummyIII) and `demo_query.fa` (two query sequences). We use the `sr` preset throughout, which is tuned for short reads.

## Basic alignment

The simplest call: pass reference path, query path, and a preset. The return value is a dict with `paf` (the raw PAF string, one alignment per line) and `stderr` (minimap2 log messages). Each of the two query sequences produces one PAF line.

```bash
cat > /tmp/mm2_basic.py << 'EOF'
result = minimap2("sample_contigs.fa", "demo_query.fa", preset="sr")
print("PAF output:")
print(result["paf"].strip())
mapped_line = [l for l in result["stderr"].splitlines() if "mapped" in l and "sequences" in l][0]
print("log: " + mapped_line.split("] ")[1])
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/mm2_basic.py
```

```output
PAF output:
a4f36092-b4d5-47a9-813e-c22c3b477a0c	48	0	42	+	dummyIII	76	23	65	42	42	18	tp:A:P	cm:i:3	s1:i:42	s2:i:0	rl:i:0
another_read	48	4	48	+	dummyII	48	4	48	44	44	28	tp:A:P	cm:i:7	s1:i:44	s2:i:0	rl:i:0
log: mapped 2 sequences
```

## Parsing PAF fields

PAF is tab-separated. The first 12 columns are fixed; columns 12+ are optional SAM-style tags. Here we loop over both PAF lines and extract the key fields.

```bash
cat > /tmp/mm2_parse.py << 'EOF'
result = minimap2("sample_contigs.fa", "demo_query.fa", preset="sr")
for line in result["paf"].splitlines():
    if not line:
        continue
    cols = line.split("\t")
    query_name   = cols[0]
    query_len    = int(cols[1])
    query_start  = int(cols[2])
    query_end    = int(cols[3])
    strand       = cols[4]
    target_name  = cols[5]
    target_len   = int(cols[6])
    target_start = int(cols[7])
    target_end   = int(cols[8])
    matches      = int(cols[9])
    block_len    = int(cols[10])
    mapq         = int(cols[11])
    identity     = matches / block_len
    print("query:    " + query_name + " (" + str(query_len) + " bp)")
    print("target:   " + target_name + " (" + str(target_len) + " bp)")
    print("strand:   " + strand)
    print("position: " + target_name + ":" + str(target_start) + "-" + str(target_end))
    print("matches:  " + str(matches) + "/" + str(block_len) + " (" + str(round(identity * 100, 1)) + "% identity)")
    print("mapq:     " + str(mapq))
    print("")
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/mm2_parse.py
```

```output
query:    a4f36092-b4d5-47a9-813e-c22c3b477a0c (48 bp)
target:   dummyIII (76 bp)
strand:   +
position: dummyIII:23-65
matches:  42/42 (100.0% identity)
mapq:     18

query:    another_read (48 bp)
target:   dummyII (48 bp)
strand:   +
position: dummyII:4-48
matches:  44/44 (100.0% identity)
mapq:     28

```

## Aligning a sequence from a string

If the sequence to align isn't already in a file, use `write_file()` to create a FASTA first, then pass that path to `minimap2()`.

```bash
cat > /tmp/mm2_write.py << 'EOF'
seq = "ACATCAAATCCACACCACACCACACCCTGGGAGCCACCATAACGGCCT"
write_file("ai_chat_temp_files/query_from_string.fa", ">constructed_query\n" + seq + "\n")
result = minimap2("sample_contigs.fa", "ai_chat_temp_files/query_from_string.fa", preset="sr")
lines = [l for l in result["paf"].splitlines() if l]
print(str(len(lines)) + " alignment(s)")
for line in lines:
    cols = line.split("\t")
    print("  " + cols[0] + " -> " + cols[5] + ":" + cols[7] + "-" + cols[8] + " strand=" + cols[4] + " matches=" + cols[9])
EOF
rm -rf ./demo/ai_chat_temp_files && node ./dist/execute-cli.mjs --dir ./demo /tmp/mm2_write.py
```

```output
1 alignment(s)
  constructed_query -> dummyIII:23-65 strand=+ matches=42
```

## Unmapped sequences

When no alignment is found, `paf` is an empty string — PAF only contains records for sequences that were placed. This happens when the preset's sensitivity is too low for the sequences involved. Running the same files without any preset produces no alignments for these short synthetic sequences.

## Unmapped sequences

When no alignment is found, `paf` is an empty string — PAF only contains records for sequences that were placed. Here we construct a poly-T query with no similarity to any contig to demonstrate this.

```bash
cat > /tmp/mm2_unmapped.py << 'EOF'
seq = "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"
write_file("ai_chat_temp_files/no_match.fa", ">no_match\n" + seq + "\n")
result = minimap2("sample_contigs.fa", "ai_chat_temp_files/no_match.fa", preset="sr")
lines = [l for l in result["paf"].splitlines() if l]
print("alignments: " + str(len(lines)))
print("paf is empty: " + str(result["paf"] == ""))
EOF
rm -rf ./demo/ai_chat_temp_files && node ./dist/execute-cli.mjs --dir ./demo /tmp/mm2_unmapped.py
```

```output
alignments: 0
paf is empty: True
```
