# nanalogue-sandbox-exec: Running Python in the Monty Sandbox

*2026-03-09T12:21:23Z by Showboat 0.6.1*
<!-- showboat-id: 3221048a-b55f-49a6-a9fa-8ec27604864a -->

nanalogue-sandbox-exec runs a Python script inside the Monty sandbox — the same sandboxed interpreter the AI Chat feature uses internally. No LLM is involved: you write the script, the sandbox executes it, and the output is printed to stdout. This is useful for testing sandbox scripts offline, verifying that analysis code works against a real BAM file, and scripting BAM analysis pipelines without launching the full Electron app.

## Basic usage: print output

```bash
echo 'print("hello from the sandbox")' > /tmp/hello.py && node ./dist/execute-cli.mjs --dir /tmp /tmp/hello.py
```

```output
hello from the sandbox
```

The sandbox has no stdlib and no imports. Arithmetic, string operations, and list comprehensions work fine since they are built into the Python interpreter.

```bash
cat > /tmp/math.py << 'EOF'
result = sum(x**2 for x in range(1, 6))
print(f'Sum of squares 1..5 = {result}')
primes = [x for x in range(2, 30) if all(x % d != 0 for d in range(2, x))]
print(f'Primes under 30: {primes}')
EOF
node ./dist/execute-cli.mjs --dir /tmp /tmp/math.py
```

```output
Sum of squares 1..5 = 55
Primes under 30: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
```

## Reading a BAM file with read_info

The sandbox exposes BAM analysis functions. `read_info` returns read-level summary data (read ID, length, alignment info) from a BAM file in the allowed directory. All arguments beyond the path are keyword-only. The BAM path in the script is relative to the `--dir` argument.

```bash
cat > /tmp/read_info_demo.py << 'EOF'
rows = read_info('demo.bam', limit=5)
print(f'Fetched {len(rows)} reads')
for r in rows:
    print(f'  read_id={r["read_id"][:20]}... length={r["sequence_length"]} mods={r["mod_count"]}')
EOF
node ./dist/execute-cli.mjs --dir ./demo /tmp/read_info_demo.py
```

```output
Fetched 5 reads
  read_id=2.67b165d3-d263-4613... length=2014 mods=A+a:293;(probabilities >= 0.5020, PHRED base qual >= 0)
  read_id=2.bf79569a-0119-4002... length=2014 mods=A+a:293;(probabilities >= 0.5020, PHRED base qual >= 0)
  read_id=2.fb2a5d3e-70b7-4f94... length=2014 mods=A+a:293;(probabilities >= 0.5020, PHRED base qual >= 0)
  read_id=2.01685678-d2c1-46df... length=2014 mods=A+a:293;(probabilities >= 0.5020, PHRED base qual >= 0)
  read_id=2.f60fa306-dda4-49ba... length=2014 mods=A+a:293;(probabilities >= 0.5020, PHRED base qual >= 0)
```

## Writing output with write_file

The sandbox can write files into the allowed directory using `write_file`. The output path is relative to `--dir`. The function refuses to overwrite existing files — this is intentional.

```bash
cat > /tmp/write_demo.py << 'EOF'
rows = read_info('demo.bam', limit=200000)
lengths = [r['sequence_length'] for r in rows]
avg = sum(lengths) / len(lengths)
report = f'Reads: {len(lengths)}\nMin length: {min(lengths)}\nMax length: {max(lengths)}\nMean length: {avg:.1f}\n'
print(report)
write_file('length_report.txt', report)
print('Written to length_report.txt')
EOF
rm -f ./demo/length_report.txt && node ./dist/execute-cli.mjs --dir ./demo /tmp/write_demo.py && cat ./demo/length_report.txt
```

```output
Reads: 900
Min length: 902
Max length: 2399
Mean length: 1778.9

Written to length_report.txt
Reads: 900
Min length: 902
Max length: 2399
Mean length: 1778.9
```

## Error handling: sandbox errors exit with code 1

Bad Python, runtime errors, and sandbox violations all exit with code 1 and print the error to stdout. The exit code makes it easy to detect failures in shell scripts.

```bash
echo 'x = 1 / 0' > /tmp/error.py
node ./dist/execute-cli.mjs --dir /tmp /tmp/error.py
echo "exit code: $?"
```

```output
RuntimeError: ZeroDivisionError: division by zero
exit code: 1
```

## Resource limits

`--max-records-read-info` sets a hard ceiling on how many records the sandbox may return from `read_info`. The script's own `limit` keyword controls how many records it requests from the Rust layer; the CLI cap is enforced on top of that. Here we show both: requesting exactly 500 with a 500 cap succeeds; requesting all records with no cap returns all 900.

```bash
cat > /tmp/limits.py << 'EOF'
rows = read_info('demo.bam', limit=500)
print(f'Got {len(rows)} rows')
EOF
echo '--- no CLI cap: request 500 of 900 ---'
node ./dist/execute-cli.mjs --dir ./demo /tmp/limits.py
echo '--- CLI cap 500: request 500 ---'
node ./dist/execute-cli.mjs --dir ./demo --max-records-read-info 500 /tmp/limits.py
echo '--- no CLI cap: request all ---'
echo 'rows = read_info("demo.bam", limit=200000)
print(f"Got {len(rows)} rows")' > /tmp/limits_all.py
node ./dist/execute-cli.mjs --dir ./demo /tmp/limits_all.py
```

```output
--- no CLI cap: request 500 of 900 ---
Got 500 rows
--- CLI cap 500: request 500 ---
Got 500 rows
--- no CLI cap: request all ---
Got 900 rows
```
