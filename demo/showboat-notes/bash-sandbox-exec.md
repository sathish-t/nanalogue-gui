# bash() in the Monty Sandbox

*2026-03-11T19:44:19Z by Showboat 0.6.1*
<!-- showboat-id: 35783f4a-a723-468b-a3f7-b932f170b6ef -->

The sandbox exposes a `bash()` function that lets Python scripts run shell commands against the files in the allowed directory. This document exercises every documented aspect of `bash()` using `nanalogue-sandbox-exec` (`node ./dist/execute-cli.mjs`) so the behaviour is captured as reproducible output.

## Return value

Every `bash()` call returns a dict with three keys: `stdout`, `stderr`, and `exit_code`. A zero exit code means success.

```bash
mkdir -p /tmp/bash-demo
cat > /tmp/bash-demo/bash_return.py << 'EOF'
result = bash("echo hello from bash")
print("stdout:    " + repr(result["stdout"].strip()))
print("stderr:    " + repr(result["stderr"]))
print("exit_code: " + str(result["exit_code"]))
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_return.py

```

```output
stdout:    'hello from bash'
stderr:    ''
exit_code: 0
```

## Inspecting files: wc, head, grep

Shell state does not persist between calls, but within a single call you can chain commands with `&&` and pipes. Here we count lines in the BED files and peek at the first few records.

```bash
cat > /tmp/bash-demo/bash_inspect.py << 'EOF'
# wc on both BED files
r = bash("wc -l swipe.bed demo-swipe-output.bed")
print("wc -l:\n" + r["stdout"])

# head the swipe BED
r = bash("head -3 swipe.bed")
print("head -3 swipe.bed:\n" + r["stdout"])

# count by strand using awk
r = bash("awk '$6==\"+\"' swipe.bed | wc -l")
plus = r["stdout"].strip()
r = bash("awk '$6==\"-\"' swipe.bed | wc -l")
minus = r["stdout"].strip()
print("plus-strand: " + plus + "  minus-strand: " + minus)
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_inspect.py

```

```output
wc -l:
 10 swipe.bed
  1 demo-swipe-output.bed
 11 total

head -3 swipe.bed:
contig_00001	8716	33716	0.29eaec2a-bf90-41cf-9334-dbcf1a602a8c	0	+
contig_00001	23046	48046	1.6d4fe0cc-790b-4b11-85a7-b2e2aa6e746a	1	-
contig_00001	12635	37635	1.a4652b11-87e8-4eb5-8d06-db06b43fa5a3	1	-

plus-strand: 5  minus-strand: 5
```

## Compound commands and pipelines

Shell state does not persist between `bash()` calls (cwd, variables, etc.), so multi-step work must be done in a single call using `&&` or pipes. Here we compute the fragment-length distribution from the BED file entirely in shell.

```bash
cat > /tmp/bash-demo/bash_pipeline.py << 'EOF'
# Compute fragment lengths (col3 - col2) and sort/count them in one pipeline
r = bash("awk '{print $3-$2}' swipe.bed | sort -n | uniq -c | awk '{print $2, $1}'")
print("fragment_len count")
print(r["stdout"])
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_pipeline.py

```

```output
fragment_len count
25000 10

```

## FASTA inspection with grep, awk, tr

The FASTA file is also in the allowed directory. We can count sequences, check contig names, and compute per-base composition without loading the whole file into Python.

```bash
cat > /tmp/bash-demo/bash_fasta.py << 'EOF'
# Count sequences
r = bash("grep -c '^>' swipe.fasta")
print("sequences: " + r["stdout"].strip())

# Contig names
r = bash("grep '^>' swipe.fasta")
print("headers:\n" + r["stdout"].strip())

# Nucleotide composition (skip all header lines, concatenate, count)
r = bash("grep -v '^>' swipe.fasta | tr -d '\\n' | fold -w1 | sort | uniq -c | sort -rn")
print("base counts:\n" + r["stdout"])
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_fasta.py

```

```output
sequences: 2
headers:
>contig_00000
>contig_00001
base counts:
25211 C
25085 T
24947 A
24757 G

```

## Writing to ai_chat_temp_files/

`bash()` can only write inside the `ai_chat_temp_files/` subdirectory of the allowed directory. Redirects to any other path fail with a read-only filesystem error. Files written there persist to disk and can be read back with `read_file()` or another `bash()` call.

```bash
cat > /tmp/bash-demo/bash_write.py << 'EOF'
# Sort the BED file by start position and save it
r = bash("sort -k2,2n swipe.bed > ai_chat_temp_files/swipe_sorted.bed")
print("write exit_code: " + str(r["exit_code"]))

# Read it back and confirm ordering
r2 = bash("head -4 ai_chat_temp_files/swipe_sorted.bed")
print("first 4 lines of sorted BED:\n" + r2["stdout"])
EOF
rm -rf ./demo/ai_chat_temp_files && node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_write.py

```

```output
write exit_code: 0
first 4 lines of sorted BED:
contig_00001	7206	32206	1.cd6c84a6-72d4-42ad-83e2-b594b0bbb645	1	+
contig_00001	8716	33716	0.29eaec2a-bf90-41cf-9334-dbcf1a602a8c	0	+
contig_00000	11875	36875	0.3599a598-2195-4537-8044-5c1cb47c0bbd	0	+
contig_00001	12635	37635	1.a4652b11-87e8-4eb5-8d06-db06b43fa5a3	1	-

```

Writes outside `ai_chat_temp_files/` fail with EROFS (read-only filesystem).

```bash
cat > /tmp/bash-demo/bash_write_denied.py << 'EOF'
# Try to write outside ai_chat_temp_files/ — the filesystem error propagates
# as a RuntimeError from bash() itself
try:
    r = bash("echo oops > swipe_modified.bed")
    print("unexpected success, exit_code: " + str(r["exit_code"]))
except Exception as e:
    msg = str(e)
    # strip the machine-specific absolute path, keep just the EROFS reason
    print("caught: " + str(type(e).__name__))
    print("message: " + msg.split(", write '")[0])
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_write_denied.py

```

```output
caught: RuntimeError
message: EROFS: read-only file system
```

## Non-zero exit codes

A command that exits with a non-zero code does not raise an exception — the exit code is returned inside the dict. This lets scripts distinguish between an empty result and an actual error.

```bash
cat > /tmp/bash-demo/bash_exitcodes.py << 'EOF'
# grep returns 1 when no match is found — not an exception
r = bash("grep 'contig_99999' swipe.bed")
print("no-match exit_code: " + str(r["exit_code"]))
print("stdout empty: " + str(r["stdout"] == ""))

# stderr is captured separately
r2 = bash("cat nonexistent_file.txt")
print("missing-file exit_code: " + str(r2["exit_code"]))
print("stderr: " + r2["stderr"].strip())
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_exitcodes.py

```

```output
no-match exit_code: 1
stdout empty: True
missing-file exit_code: 1
stderr: cat: nonexistent_file.txt: No such file or directory
```

## Unavailable commands

Bioinformatics tools and language runtimes are not available. Attempting to call them returns a non-zero exit code with `command not found` in stderr. The available set is: grep, sed, awk, sort, uniq, wc, cut, head, tail, cat, find, tr, paste, jq, and standard bash builtins.

```bash
cat > /tmp/bash-demo/bash_unavailable.py << 'EOF'
for cmd in ["samtools view demo.bam", "python3 --version", "bedtools --version"]:
    r = bash(cmd)
    label = cmd.split()[0]
    print(label + ": exit_code=" + str(r["exit_code"]) + " stderr=" + repr(r["stderr"].strip()[:50]))
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_unavailable.py

```

```output
samtools: exit_code=127 stderr='bash: samtools: command not found'
python3: exit_code=127 stderr='bash: python3: command not available in browser en'
bedtools: exit_code=127 stderr='bash: bedtools: command not found'
```

## Combining bash() with read_info()

`bash()` is most useful when paired with the BAM query functions. Here we fetch all read lengths from the BAM with `read_info()`, write them to `ai_chat_temp_files/` as a TSV, then use `bash()` to compute summary statistics and find the top-5 longest reads.

```bash
cat > /tmp/bash-demo/bash_combined.py << 'EOF'
# Fetch all read lengths from the BAM and write as TSV for bash processing
rows = read_info("demo.bam", limit=200000)
lines = ["read_id\tlength"]
for r in rows:
    lines.append(r["read_id"] + "\t" + str(r["sequence_length"]))
tsv = "\n".join(lines) + "\n"
write_file("ai_chat_temp_files/reads.tsv", tsv)
print("wrote " + str(len(rows)) + " rows to reads.tsv")

# Use bash to compute length stats
r = bash("tail -n +2 ai_chat_temp_files/reads.tsv | awk '{s+=$2; if(NR==1||$2<mn)mn=$2; if($2>mx)mx=$2} END{printf \"n=%d min=%d max=%d mean=%.0f\\n\", NR, mn, mx, s/NR}'")
print("length stats: " + r["stdout"].strip())

# Top-5 longest reads using sort + head
r2 = bash("tail -n +2 ai_chat_temp_files/reads.tsv | sort -k2,2rn | head -5 | awk '{print $2, $1}'")
print("top-5 by length (len read_id):\n" + r2["stdout"])
EOF
rm -rf ./demo/ai_chat_temp_files && node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_combined.py

```

```output
wrote 900 rows to reads.tsv
length stats: n=900 min=902 max=2399 mean=1779
top-5 by length (len read_id):
2399 0.4cbd17aa-2877-4351-a7d3-fba71b907f3e
2399 0.752aa36a-020a-4824-a43f-bcbf67047f38
2398 0.9add3187-2dcf-44d8-960f-0ed6da3fc174
2397 1.3b70802d-2273-405a-8872-dc7bf9b0c594
2396 1.7fe1e057-c629-4c78-ba12-36f97e1d8de7

```

## Available tools: a complete text-processing pipeline

`bash()` is well-suited for summarising data already written to `ai_chat_temp_files/`. Here we compute a read-length histogram from the TSV written in the previous section and render it as a text bar chart entirely in shell using awk and sort.

```bash
cat > /tmp/bash-demo/bash_histogram.py << 'EOF'
r = bash("tail -n +2 ai_chat_temp_files/reads.tsv | awk '{bin=int($2/200)*200; count[bin]++; total++} END{for(k in count){pct=count[k]*100/total; bar=\"\"; for(j=0;j<int(pct/2+0.5);j++) bar=bar \"#\"; printf \"%d-%d bp  %3d  %s\\n\", k, k+199, count[k], bar}}' | sort -n")
print(r["stdout"])
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/bash-demo/bash_histogram.py
rm -rf /tmp/bash-demo

```

```output
800-999 bp   41  ##
1000-1199 bp   77  ####
1200-1399 bp   75  ####
1400-1599 bp   79  ####
1600-1799 bp   78  ####
1800-1999 bp   90  #####
2000-2199 bp  373  #####################
2200-2399 bp   87  #####

```
