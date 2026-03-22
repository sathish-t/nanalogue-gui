# Architecture

This document defines the layers of `nanalogue-gui`, the permitted dependency
directions between them, and examples of what belongs in each layer.
These rules are conventions enforced by code review.

---

## Layer diagram

```
┌──────────────────────────────────────────────────────┐
│  renderer/  (browser context — no Node.js)           │
│  e.g. landing, swipe, qc, locate, ai-chat, shared, … │
└────────────────────┬─────────────────────────────────┘
                     │ window.electronAPI (contextBridge)
┌────────────────────▼────────────────────────────────┐
│  preload.ts  (IPC bridge only — no business logic)  │
└────────────────────┬────────────────────────────────┘
                     │ ipcMain.handle / ipcMain.on
┌────────────────────▼────────────────────────────────┐
│  modes/  (Electron main-process IPC handlers)       │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  lib/  (pure business logic)                        │
│  e.g. parsers, loaders, orchestrators, sandbox, ... │
└─────────────────────────────────────────────────────┘

```

The main process entry orchestrates `modes/` and `lib/`.
The CLI entry points use `lib/` directly, bypassing Electron entirely.

---

## Layer rules

### `src/lib/`
**May use:** `@nanalogue/node`, `@pydantic/monty`, Node.js built-ins
(`fs`, `path`, `crypto`, `fetch`), third-party packages with no Electron/DOM
dependency.

**Must NOT use:** `electron`, `ipcMain`, `BrowserWindow`, or any DOM API
(`document`, `window`, `HTMLElement`, etc.).

**Why:** `lib/` is shared by the Electron app *and* the standalone CLIs.
Any Electron import would break `cli.ts` and `execute-cli.ts` at build time.

### `src/modes/`
**May use:** `electron` (`ipcMain`, `dialog`, `shell`), `lib/`,
`@nanalogue/node` (for direct calls not yet abstracted into lib).

**Must NOT use:** DOM APIs (`document`, `window`, `HTMLElement`).

**Why:** Modes run in the Node.js main process, not the browser context.

### `src/preload.ts`
**May use:** `electron` (`contextBridge`, `ipcRenderer` only).

**Must NOT contain:** Business logic. The preload file should only
translate renderer calls into `ipcRenderer.invoke`/`send` and expose
them via `contextBridge.exposeInMainWorld`.

### `src/renderer/`
**May use:** DOM APIs, `chart.js`, `chartjs-plugin-annotation`.
Communicates with main process only via `window.electronAPI`.

**Must NOT use:** `electron`, `@nanalogue/node`, `@pydantic/monty`, or
Node.js built-ins (`fs`, `path`, `process`, etc.).

**Why:** Renderer pages are loaded as browser pages; native module imports
crash the renderer.

**Type imports:** Renderer files that need types already exported from
`lib/` must import them with `import type { … } from "../../lib/…"` rather
than redefining them locally. Local redefinitions are a DRY violation: if
the `lib/` definition gains a new field, the renderer's copy silently drifts
and TypeScript will not catch the divergence.

### `src/cli.ts` / `src/execute-cli.ts`
**May use:** `lib/`, Node.js built-ins, `readline`, `process`.

**Must NOT use:** `electron`, DOM APIs.

---

## What belongs in `lib/` vs `modes/`

| Concern | Layer |
|---|---|
| Parsing a genomic region, BED line, or filter string | `lib/` |
| Running the AI chat agentic loop | `lib/` |
| Executing Python in the Monty sandbox | `lib/` |
| Loading and transforming BAM data for any mode | `lib/` |
| Validating IPC payloads received from the renderer | `lib/` |
| Registering `ipcMain.handle(...)` handlers | `modes/` |
| Opening a native file picker or dialog | `modes/` |
| Forwarding IPC events to the renderer | `modes/` |
| Rendering charts or manipulating the DOM | `renderer/` |
| Reusable input widgets shared across pages | `renderer/shared/` |

---

## IPC naming convention

IPC channel names follow the pattern `<mode>:<action>`, e.g.:
- `ai-chat:send-message`
- `qc:load-data`
- `swipe:next`

Channels are defined as string constants in `lib/` (for AI chat) or inline
in the relevant `modes/` file. Do not invent new string literals in multiple
files — define them once.
