# `@pydantic/monty` — Codebase Usage Reference

Embedded Python interpreter for the AI Chat sandbox. Runs Python code
inside Node.js without spawning a subprocess. Import from `@pydantic/monty`.

For exact TypeScript types, read `node_modules/@pydantic/monty/wrapper.d.ts`
directly — that file is the source of truth. This document covers how Monty
is used in this codebase and the conventions around it.

---

## The one rule

`src/lib/monty-sandbox.ts` wraps the full execution loop.
**Do not call Monty directly from any other file.**

---

## How it works

You construct a `Monty` instance with the Python code and declare two things
upfront: the names of variables that will be injected as inputs, and the
names of Python functions that will be satisfied by JavaScript callbacks.
When the Python code calls one of those functions, Monty pauses and yields
to JavaScript; your callback runs and its return value is handed back to
Python. `runMontyAsync` drives this loop automatically, handling both sync
and async JS callbacks.

The return value of `runMontyAsync` is the value of the last expression in
the Python script (like a REPL). In this codebase the final expression is
always a string or `None`.

---

## Why `runMontyAsync` and not the low-level API

The `.d.ts` also exposes a lower-level `Monty.start()` /
`MontySnapshot.resume()` manual callback loop. **This codebase does not use
it.** Always use `runMontyAsync`.

---

## Resource limits

Three limits matter in practice:

- **`timeout`** — wall-clock timeout in milliseconds. Default in this
  codebase is 10 minutes.
- **`maxHeapBytes`** — heap memory cap in bytes.
- **`maxAllocations`** — counts object *creations*, not bytes. A tight loop
  that creates many small objects can hit this cap even if memory usage is
  low. Set it with that in mind.

---

## Error types

There are three error classes, all extending `MontyError` which extends
`Error`: `MontySyntaxError` (bad Python syntax), `MontyRuntimeError`
(exception thrown at runtime), and `MontyTypingError` (type-checking
failure). In `src/lib/monty-sandbox.ts` these are caught and converted to a
`SandboxResult` with `success: false`. The error type name is preserved so
the orchestrator can send typed error feedback to the LLM.

---

## What sandbox Python code can and cannot do

The Python code the LLM writes can only interact with the outside world
through the registered `externalFunctions`. There is no `import`, no
filesystem access, no network — only the functions explicitly registered
in `src/lib/monty-sandbox.ts`. See [`ai-chat.md`](../ai-chat.md)
for the full list of external functions and their resource limits.
