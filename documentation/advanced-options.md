# AI Chat Advanced Options

This page is a reference for every tuneable option in AI Chat. All options are
available in both the GUI (Advanced Options dialog) and the `nanalogue-chat`
CLI. A subset of sandbox and data-query options also applies to
`nanalogue-sandbox-exec`, the standalone sandbox runner that executes Python
scripts without an LLM.

---

## 1. LLM Connection Settings

These options control how `nanalogue-chat` talks to the LLM. They have no
effect in `nanalogue-sandbox-exec`.

| Option | CLI flag | Default | Range | Description |
|---|---|---|---|---|
| Context window tokens | `--context-window` | 200,000 | 8,000–2,000,000 | Token budget for the conversation. The orchestrator budgets within 80 % of this value, accounting for the system prompt and completion allowance before fitting history. Use a larger value for long conversations or when working with many BAM files at once or if you are using an LLM that supports more tokens. |
| Max retries | `--max-retries` | 20 | 1–50 | Maximum retries after the initial LLM request attempt, within the logical call's timeout budget. Increase for flaky or rate-limited endpoints; the timeout may expire before all retries are used. |
| LLM response timeout (s) | `--timeout` | 300 | 1–3,600 | Total wall-clock budget per logical LLM call, shared across all HTTP attempts, retry backoff, and response body reads (including error bodies). It does not reset on retry. When it expires, the call is aborted and an error is shown. Increase for slow local models. |
| Temperature | `--temperature` | provider default | 0–2 | LLM sampling temperature. Leave blank (GUI) or omit the flag (CLI) to use the provider's own default. Lower values produce more deterministic code; higher values more creative responses. |
| Max code rounds | `--max-code-rounds` | 30 | 1–50 | Maximum Python execution rounds per user message before one forced-final LLM call. Increase if the model needs many iterations to complete a complex analysis. |

Each new logical LLM call, including a later code round or the forced-final
call, gets a fresh timeout budget. Sandbox execution and time spent waiting
for sandbox admission do not consume that budget. This is not a total
timeout for the user message.

**When to change:**

- *Long conversations or large file sets or a suitable LLM* — increase context window tokens.
- *Slow or remote model* — increase LLM response timeout.
- *Rate-limited cloud endpoint* — increase max retries.
- *Reproducible outputs needed* — set temperature to 0.
- *Model keeps hitting the round cap* — increase max code rounds.

---

## 2. Sandbox Resource Limits

These options cap the resources available to Python code running inside the
Monty sandbox. They apply to both `nanalogue-chat` and
`nanalogue-sandbox-exec`.

| Option | CLI flag | Default | Range | Description |
|---|---|---|---|---|
| Max execution time (seconds) | `--max-duration-secs` | 1,800 | 1–604,800 | Best-effort execution time limit per sandbox run. Bash commands are actively cancelled when this fires; native data-access operations already in progress may complete in the background. The LLM is told the actual value you set, so it can plan accordingly. Increase for computationally heavy scripts. |
| Max sandbox memory (MB) | `--max-memory-mb` | 512 | 1–65,536 | Heap memory cap for the sandbox process. Increase when working with large dataframes or high-coverage BAM regions. |
| Max sandbox allocations | `--max-allocations` | 100,000,000 | 1–100,000,000,000 | Monty VM allocation cap. Acts as a secondary safety net independent of memory. Change as needed depending on the task at hand. |
| Max read_file size (MB) | `--max-read-mb` | 1 | 1–100 | Maximum bytes the sandbox `read_file()` function may read in a single call. Increase if your analysis scripts need to read large text or CSV files. |
| Max write_file size (MB) | `--max-write-mb` | 50 | 1–100 | Maximum bytes the sandbox `write_file()` function may write in a single call. Increase if the model needs to produce large output files (e.g. BED files with millions of rows). |

**When to change:**

- *Script hits the execution time limit during heavy computation* — increase max execution time.
- *Script crashes with memory errors on large datasets* — increase max memory.
- *Script needs to ingest a large reference or annotation file* — increase max read_file size.
- *Script produces a large output file* — increase max write_file size.

Note: one allocation is one object creation (a list, a dict, a string, an
integer, etc.), not one byte. The default is 100,000,000 allocations;
allocation count and heap memory are separate limits.

---

## 3. Data Query Limits

These options cap how many records each BAM-query function may return per
call. They apply to both `nanalogue-chat` and `nanalogue-sandbox-exec`. The
LLM is told the exact limits in its system prompt, so it can write code that
pages through results if necessary.

| Option | CLI flag | Default | Range | Description |
|---|---|---|---|---|
| Max read_info records | `--max-records-read-info` | 200,000 | 1–1,000,000 | Record cap for `read_info()`, which returns per-read metadata. Increase for whole-genome datasets where you need a full read census. |
| Max bam_mods records | `--max-records-bam-mods` | 5,000 | 1–1,000,000 | Record cap for `bam_mods()`, which returns per-position base modification calls. Keep low for high-coverage regions to avoid memory pressure. |
| Max window_reads records | `--max-records-window-reads` | 5,000 | 1–1,000,000 | Record cap for `window_reads()`, which returns modification data averaged per genomic window. |
| Max seq_table records | `--max-records-seq-table` | 5,000 | 1–100,000 | Record cap for `seq_table()`, which returns per-position sequence and statistics. |

**When to change:**

- *Analysis requires a census of all reads* — increase max read_info records.
- *Working with a low-coverage BAM or a small region* — the defaults are
  fine; reducing limits can speed up queries.
- *Model reports it hit a record cap and is missing data* — increase the
  relevant limit.

---

## 4. Output Limit (`nanalogue-sandbox-exec` only)

`nanalogue-sandbox-exec` has one additional option not present in
`nanalogue-chat`, because it writes directly to stdout rather than feeding
output back to an LLM.

| Option | CLI flag | Default | Description |
|---|---|---|---|
| Max output bytes | `--max-output-bytes` | 10,485,760 (10 MiB) | Inline output limit. Larger prints and returned strings, lists, or dictionaries are saved in full under `ai_chat_output/`, with file notices on stdout rather than truncated data. Prints and serialized returned values each have a fixed 50 MiB ceiling; exceeding it fails instead of partially delivering that output. File notices are not clipped to the inline limit. |

**When to change:**

- *Script produces more than 10 MiB of output that you want inline* —
  increase this value. It accepts positive integers; the fixed 50 MiB output
  ceilings still apply independently of `--max-write-mb`.

---

## 5. GUI vs CLI

All options in sections 1–3 are available in both the GUI and
`nanalogue-chat`. In the GUI, they appear in the Advanced Options dialog
(accessible from the AI Chat config panel). On the CLI, they are passed as
flags to `nanalogue-chat`.

`nanalogue-sandbox-exec` supports options from sections 2–4. It has no LLM
connection settings (section 1) because it does not contact an LLM.
