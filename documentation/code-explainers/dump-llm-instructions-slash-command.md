# `/dump_llm_instructions` Slash Command

The `/dump_llm_instructions` command lets a developer inspect exactly
what was sent to the LLM in the most recent API call — the full system
prompt plus the conversation history after any sliding-window transform.
The output is written as a human-readable plain-text file to
`{allowedDir}/ai_chat_output/`.

---

## What it does

When the user types `/dump_llm_instructions` in the chat REPL, the
command:

1. Retrieves the stored messages array from the last LLM round.
2. Writes it to a uniquely named log file in `ai_chat_output/`.
3. Returns the relative path of the written file as the response.
4. Does **not** feed the command itself back to the LLM.

If no LLM call has been made in the current session yet, the command
returns `"No LLM call has been made yet, nothing to dump."` and writes
nothing.

---

## Output

Files are named `nanalogue-chat-{yyyy-mm-dd}-{uuid}.log` and written
to `{allowedDir}/ai_chat_output/`. Each message is separated by a
plain-text section header:

```
=== Message 1: system ===

<system prompt text>

=== Message 2: user ===

<first user message>

=== Message 3: assistant ===

<LLM reply>
```

The assistant's reply is appended after each round, so the dump
captures both the request and the response.

---

## How it works

`chat-orchestrator.ts` holds a module-level variable `lastSentMessages`
that stores the full messages array. It is set right before each
`fetchChatCompletion` call (so it is populated even if the call fails),
and the assistant's reply is appended right after. The handler in
`handleUserMessage()` pops the command from conversation history, reads
this variable, formats it, and writes the file. On "New Chat",
`ChatSession.reset()` clears the variable so a fresh session starts
clean. Three small accessor functions (`resetLastSentMessages`,
`getLastSentMessages`, `setLastSentMessages`) are exported purely for
test isolation.

---

## Notable choices

- **Plain-text over JSON.** Section headers (`=== Message N: role ===`)
  are easier to read in a text editor or terminal pager than raw JSON.
- **No pre-chat dump.** When no LLM call has been made yet, the command
  returns an informational message rather than constructing a synthetic
  system-prompt dump, keeping the handler simple.
- **No always-on logging.** The dump is entirely on-demand — no
  background file writing or IPC wiring — so the normal chat path has
  no I/O side-effects.
- **Module-level variable, not a session field.** The app has at most
  one active `ChatSession` at a time, so module scope is sufficient and
  avoids threading the value through `HandleMessageOptions`.

---

## Files

| File | Role |
|---|---|
| `src/lib/chat-orchestrator.ts` | `lastSentMessages` variable, pre/post-call storage, command handler |
| `src/lib/chat-session.ts` | Calls `resetLastSentMessages()` in `reset()` |
| `src/lib/chat-orchestrator.test.ts` | Functional tests |
| `src/lib/chat-session.test.ts` | Wiring test for `reset()` |
