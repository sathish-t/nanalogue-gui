# rodney demo — landing page walkthrough & locate-bed roundtrip

Drives the live Electron app through automated tests using
[rodney](https://github.com/simonw/rodney), a Chrome automation CLI
that speaks the DevTools Protocol.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) installed (`uvx rodney` fetches and
  runs rodney automatically — no separate install needed)
- The app built and running in debug mode:

```bash
npm run build
./scripts/start-debug.sh   # leaves Electron open on port 9222
```

## Running the tests

In a second terminal, from the project root:

```bash
./demo/rodney-demo/demo.sh        # landing page walkthrough
./demo/rodney-demo/locate-bed.sh  # locate-bed roundtrip
```

---

## `demo.sh` — landing page walkthrough

1. Asserts all five mode buttons are present and enabled
2. Asserts all three font-size controls are visible
3. Opens the version dialog and checks it contains version text
4. Saves two screenshots to `/tmp/rodney-demo-<timestamp>/`

---

## `locate-bed.sh` — locate-bed roundtrip

1. Extracts column 4 of `demo/swipe.bed` as a read-IDs input file
2. Navigates landing → **Locate Reads**
3. Injects file paths into the DOM and fires the custom events the page
   listens for; real IPC handlers (`peekBam`, `locateGenerateBed`) run
   against the demo files
4. Asserts the Generate button enables, clicks it, waits for the results panel
5. Sorts columns 1–4 of the output BED and `demo/swipe.bed` and asserts
   an exact match
6. Saves three 1920×1080 screenshots to `/tmp/rodney-locate-bed-<timestamp>/`
