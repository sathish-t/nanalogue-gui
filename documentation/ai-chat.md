# AI Chat

AI Chat is an LLM-powered mode that lets users ask natural-language questions
about their BAM files. The user provides an OpenAI-compatible HTTP endpoint
and a directory of BAM files. The LLM generates Python code; the orchestrator
runs it in a sandboxed interpreter, feeds the results back to the LLM, and
shows the final output to the user.

---

## Architecture overview

```
User message
     │
     ▼
ChatSession (src/lib/chat-session.ts)
     │  owns history, facts, abort controller
     ▼
handleUserMessage (src/lib/chat-orchestrator.ts)
     │  builds system prompt, manages the agentic loop
     ├──► fetchChatCompletion → LLM endpoint (raw fetch, no SDK)
     │         returns Python code as plain text
     ├──► runSandboxGuarded → Monty sandbox (src/lib/monty-sandbox.ts)
     │         executes code, captures print() output and expression value
     │         external functions: peek, read_info, bam_mods, window_reads,
     │         seq_table, ls, read_file, write_file, continue_thinking
     └──► result fed back to LLM or shown to user
```

Both the Electron GUI (`src/modes/ai-chat.ts`) and the standalone CLI
(`src/cli.ts`) share the same `ChatSession` — no orchestration logic is
duplicated between them.

---

## The orchestrator loop

Each user message triggers a multi-round execution loop in
`handleUserMessage()`:

1. **Build context** — call `transformContext()` to prune old failed rounds
   and apply the sliding window, then `convertToLlmMessages()` to strip
   internal metadata before sending.
2. **Call the LLM** — `fetchChatCompletion()` sends a plain
   `/chat/completions` request. The response is Python code (no tool
   calling, no structured JSON schema).
3. **Handle truncation** — if `finish_reason` is `"length"`, feed back a
   message asking the LLM to write shorter code rather than executing
   truncated code.
4. **Fence extraction** — if the raw response produces a `SyntaxError`,
   attempt to extract code from markdown fences (`` ```python ... ``` ``)
   before burning a retry round.
5. **Execute** — `runSandboxGuarded()` runs the code in the Monty sandbox.
   Print output is captured via `printCallback`; the final expression value
   is the result.
6. **Decide next action:**
   - Code succeeded and `continue_thinking()` was **not** called → the
     print output and expression value are the final answer shown to the
     user. Loop ends.
   - Code succeeded and `continue_thinking()` **was** called → the result
     is fed back to the LLM as a `user`-role message and the loop
     continues.
   - Code failed → the error (typed as `SyntaxError`, `RuntimeError`, etc.)
     is fed back to the LLM and the loop continues.
7. **Max rounds** — if `maxCodeRounds` is hit without a terminal answer,
   one forced-final prompt is sent asking the LLM to answer without
   calling `continue_thinking()`.

All execution feedback messages are marked `isExecutionResult: true` on
the `UserMessage` so they can be distinguished from real user input by the
renderer and by `pruneFailedRounds()`.

---

## The Monty sandbox

The sandbox is an embedded Python interpreter (`@pydantic/monty`) running
in the Node.js main process. It has no filesystem, network, or import
access — the only way code can interact with the outside world is through
the nine registered external functions.

### External functions

The record limits and file size limits shown below are defaults — all of them
are user-configurable. See [advanced-options.md](advanced-options.md).

| Function | What it does |
|---|---|
| `peek(file)` | Summary info for a BAM/CRAM file (contigs, modifications) |
| `read_info(file, ...)` | Per-read metadata, up to 200 000 records |
| `bam_mods(file, ...)` | Per-read base-modification data, up to 5 000 records |
| `window_reads(file, ...)` | Reads in a genomic window, up to 5 000 records |
| `seq_table(file, ...)` | Sequence table for a region |
| `ls(glob?)` | Lists files under the allowed directory, up to 500 entries |
| `read_file(path, ...)` | Reads a text file, up to 1 MB per call |
| `write_file(path, content)` | Writes to `{allowedDir}/ai_chat_output/` only |
| `continue_thinking()` | Signals the orchestrator to feed this round's output back to the LLM instead of showing it to the user |

All path arguments go through `resolvePath()`, which calls `realpath` and
rejects anything that resolves outside `allowedDir` — including symlinks
that point outside it.

### Resource limits

> All limits listed here are defaults and are user-configurable via the
> Advanced Options dialog (GUI) or CLI flags. See
> [advanced-options.md](advanced-options.md).

Two layers of limits protect the host process:

- **Monty runtime** — wall-clock timeout (default 10 min), heap cap (512 MB),
  allocation cap (100 000 objects).
- **Wrapper level** — record caps passed as `limit` directly to the
  `@nanalogue/node` Rust layer (so large BAMs stop reading early rather
  than materialising in memory), output cap derived from the model's context
  window (15% of context budget, clamped to 4 KB–80 KB), `ls` capped at
  500 entries, `read_file` capped at 1 MB, `write_file` capped at 50 MB.

---

## Context management

Long conversations are handled by a two-phase pipeline called before every
LLM request:

1. **`pruneFailedRounds()`** — removes old assistant-code + user-error pairs
   from history, keeping only the most recent failed pair so the LLM can see
   its last error without accumulating noise from earlier failures.
2. **`applySlidingWindow()`** — drops the oldest messages to keep the
   assembled context within ~80% of the model's context budget.

In addition, a **facts array** accumulates structured facts extracted from
each round's sandbox result (which files were referenced, which filters were
applied, what outputs were written). Facts are rendered as a JSON data block
in the system prompt so the LLM always has key session context even after old
messages slide out of the window. Facts from truncated outputs are not
extracted. The facts array is cleared on "New Chat".

---

## Security model

The sandbox prevents LLM-generated code from accidentally accessing files
outside `allowedDir` or consuming excessive resources. It is **not** a
hardened sandbox against a determined adversary — it is designed for safe
accidental use.

The LLM endpoint receives the full conversation, including sandbox results
containing BAM data. This is unavoidable — the LLM needs to see the data to
answer questions about it. Choosing a trusted endpoint is the user's
responsibility. A consent modal appears the first time a non-localhost
endpoint is used. Consent is keyed by full origin (scheme + host + port)
so a protocol downgrade requires fresh consent.

API keys are held in memory only — never written to disk, logs, or error
messages.

---

## Notable design choices

- **Code-only responses, not tool calling.** Tool calling (function calling)
  is inconsistently supported across LLM providers, especially smaller and
  local models. Plain Python code is the most universally supported LLM
  capability. If a model wraps its code in markdown fences despite
  instructions, the orchestrator silently strips them rather than burning
  a retry round.
- **No Vercel AI SDK.** The SDK was used in an early version for HTTP
  transport and the tool-call loop. It was removed because (a) the
  tool-call paradigm was dropped, and (b) raw `fetch` to
  `/chat/completions` is simpler, more transparent, and requires no
  dependency. Model listing already used raw fetch; everything now does.
- **`continue_thinking()` as the continuation signal.** The default is
  terminal — output goes to the user unless the LLM explicitly asks for
  another round. This is a better failure mode for weaker models: they
  produce a premature answer rather than no answer at all.
- **Deterministic sliding window instead of LLM summarisation.** Scientific
  workflows depend on exact filter values, coordinate ranges, and filenames.
  Lossy LLM summarisation can silently corrupt facts. The sliding window
  keeps the most recent messages verbatim and the facts array preserves
  key structured data exactly.
- **Facts rendered as a JSON data block, not prose.** Untrusted strings
  (filenames, filter descriptions) injected verbatim into the system prompt
  as prose is a prompt-injection path. A structured JSON block reduces that
  surface.

---

## Files

| File | Role |
|---|---|
| `src/lib/chat-orchestrator.ts` | `handleUserMessage()`, agentic loop, context pipeline, `fetchChatCompletion()`, facts extraction |
| `src/lib/chat-session.ts` | `ChatSession` class — owns history, facts, abort controller; shared by GUI and CLI |
| `src/lib/chat-types.ts` | Shared types: `HistoryEntry`, `SandboxResult`, `AiChatConfig`, `AiChatEvent`, `Fact` |
| `src/lib/monty-sandbox.ts` | Sandbox wrapper — external functions, path validation, resource limits, `runSandboxCode` |
| `src/lib/sandbox-prompt.ts` | `buildSandboxPrompt()` — the system prompt template sent to the LLM each round |
| `src/lib/ai-chat-shared-constants.ts` | `CONFIG_FIELD_SPECS`, `TEMPERATURE_SPEC`, default values |
| `src/lib/ai-chat-ipc-validation.ts` | Main-process IPC payload validation (renderer input treated as untrusted) |
| `src/modes/ai-chat.ts` | Electron IPC glue — consent dialogs, directory picker, event forwarding |
| `src/cli.ts` | Standalone CLI REPL (`nanalogue-chat`) — same `ChatSession`, ANSI output |
