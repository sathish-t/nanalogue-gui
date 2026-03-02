# `nanalogue-sandbox-exec` CLI

`nanalogue-sandbox-exec` runs a Python script directly in the Monty
sandbox — the same environment as `/exec` in `nanalogue-chat` — with
no LLM involved. It is the tool of choice when you have a ready-made
analysis script and just want to run it against BAM data.

---

## What it does

```
nanalogue-sandbox-exec --dir /data/bams analysis.py
```

1. Reads the Python script from the filesystem (resolved from CWD).
2. Runs it in the Monty sandbox with the same external functions and
   resource limits available in chat (`read_info`, `bam_mods`, etc.).
3. Prints output to stdout; prints errors to stderr and exits with
   code `1`.

---

## Options

All sandbox resource limits (`--max-records-*`, `--max-duration-secs`,
`--max-memory-mb`, `--max-allocations`, `--max-read-mb`,
`--max-write-mb`) are shared with `nanalogue-chat` through
`src/lib/sandbox-cli-args.ts` so they are defined once and stay in
sync.

The one option that differs is `--max-output-bytes`. In chat this is
derived from `--context-window` (15% of the context budget, clamped to
4 KB–80 KB). Here there is no LLM context to worry about, so it is
exposed directly and defaults to **10 MB**, with an in-memory print
buffer hard ceiling of **100 MB** to prevent accidental OOM.

LLM-specific flags (`--endpoint`, `--model`, `--temperature`,
`--context-window`, `--max-retries`, `--max-code-rounds`, etc.) are
absent — they have no meaning without an LLM loop.

---

## How it works

The execution path is intentionally thin:

1. **Arg parsing** — `node:util parseArgs` with the shared
   `SANDBOX_ARG_DEFS` spread in.
2. **Script read** — `fs.readFile` resolved from CWD. The script does
   not need to live inside `--dir`; `--dir` is only the sandbox root
   for BAM access and `write_file` output.
3. **Sandbox run** — calls `runSandboxCode` directly (not
   `runSandboxGuarded`). The guarded variant adds an orphan-execution
   lock for the LLM loop's cancel/restart concurrency; there is no
   concurrency here.
4. **Output** — collected via `collectTerminalOutput` from
   `monty-sandbox.ts`, then sliced to `--max-output-bytes` with a
   truncation note appended if cut short. Silent scripts produce truly
   empty stdout (no placeholder text) so callers can rely on exit code
   alone. Stdout is drained before exit to handle pipelines cleanly,
   including graceful EPIPE handling.
5. **On error** — any print output captured before the failure is
   flushed to stdout first, then the error is written to stderr and the
   process exits with code `1`.

---

## Notable choices

- **Script path resolved from CWD, not `--dir`.** Requiring the script
  to live inside the BAM directory would be awkward. `--dir` is purely
  the sandbox access root.
- **`runSandboxCode` not `runSandboxGuarded`.** The guard exists for
  LLM-loop concurrency; it is unnecessary overhead here.
- **No terminal-overflow redirect.** Chat's `/exec` redirects large
  output to a file in `ai_chat_output/` to protect the LLM context.
  Here, everything goes to stdout and the user can pipe it freely.
- **No `(No output produced.)` placeholder.** That message exists for
  the chat UI. A silent script should produce zero bytes on stdout.
- **Shared sandbox arg definitions.** `src/lib/sandbox-cli-args.ts`
  holds `SANDBOX_ARG_DEFS` and `buildSandboxRunOptions`, imported by
  both `cli.ts` and `execute-cli.ts`, so sandbox flags never diverge
  between the two binaries.

---

## Files

| File | Role |
|---|---|
| `src/execute-cli.ts` | Entry point — arg parsing, file read, sandbox run, output |
| `src/lib/sandbox-cli-args.ts` | Shared sandbox flag definitions and option builder |
| `src/lib/monty-sandbox.ts` | `runSandboxCode`, `collectTerminalOutput` |
| `dist/execute-cli.mjs` | Built output (esbuild) |
