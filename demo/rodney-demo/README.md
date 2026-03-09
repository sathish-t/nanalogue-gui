# rodney demo — landing page walkthrough

Drives the live Electron app through a landing-page walkthrough using
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

## Running the demo

In a second terminal, from the project root:

```bash
./demo/rodney-demo/demo.sh
```

## What it does

1. Connects rodney to the running Electron instance on port 9222
2. Navigates to the landing page
3. Asserts all five mode buttons are present and enabled
4. Asserts all three font-size controls are visible
5. Opens the version dialog and checks it contains version text
6. Closes the dialog
7. Saves two screenshots to `/tmp/rodney-demo-<timestamp>/`
