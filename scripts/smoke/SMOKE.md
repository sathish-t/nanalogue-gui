# Smoke Tests

Agent-driven smoke tests that launch a fresh Electron instance, drive it
through real user flows via Playwright, and report pass/fail. No manually
running app is required — the scripts are fully autonomous.

Note: these tests cover landing, swipe, and QC modes. AI Chat is covered
separately by `demo/take-screenshots.mjs`.

---

## Quick start

```bash
./scripts/smoke/smoke-all.sh
```

Or run a single suite:

```bash
node scripts/smoke/landing.mjs
node scripts/smoke/swipe.mjs
node scripts/smoke/qc.mjs
```

Screenshots land in `/tmp/smoke-<suite>-<timestamp>/`.

---

## What each suite checks

| Suite | Checks |
|---|---|
| `landing` | All five mode buttons present and enabled; font-size controls visible; version dialog opens with correct version text and closes cleanly |
| `swipe` | Swipe config page loads; `swipeStart` IPC call succeeds with demo files; chart canvas renders in the review view; annotation counter is visible; accepting an annotation advances the counter |
| `qc` | QC config page loads; `generateQC` IPC call succeeds with demo BAM; results page renders all five tabs; four tabs contain a chart canvas; the sequences tab displays text content |

All suites use files committed to the `demo/` directory — no external data needed.

---

## When to run

After any change, run `npm run test`. If your change affects anything the
user sees in the app, also run `./scripts/smoke/smoke-all.sh`.

---

## Interactive debugging (separate from smoke tests)

If you need to poke around a live app interactively — inspect the DOM, eval
JS, take ad-hoc screenshots — use:

```bash
./scripts/start-debug.sh
```

This launches the app with `--remote-debugging-port=9222` and leaves it open.
You can then connect to it with any CDP-compatible tool (e.g. Playwright's
`chromium.connectOverCDP`, browser DevTools, etc.). This is unrelated to the
smoke tests and is intended for human debugging sessions or ad-hoc agent
exploration.

---

## On reading screenshots — token cost warning

Screenshots are saved as a side effect of every smoke run but **do not read
them routinely**. Each image costs roughly 3,000–6,000 tokens. The full suite
saves ~11 screenshots — reading all of them could cost 30,000–60,000 tokens.

Only read screenshots if:
- A suite passed but you have a specific reason to doubt the visual output
  (e.g. you changed a layout or chart)
- A suite failed and the error message alone is not enough to diagnose why

---

## Notes

- `smoke-all.sh` accepts suite names as arguments:
  `./scripts/smoke/smoke-all.sh landing qc` runs only those two.
- All suites are independent and safe to run in any order.
- Each suite launches and closes its own Electron instance.
