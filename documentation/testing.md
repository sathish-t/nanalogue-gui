# Testing Guide

## Running tests

| Command | Purpose |
|---|---|
| `npm test` | Run all unit and integration tests once. Exit 1 on failure. |
| `npm run test:watch` | Watch mode; re-run tests on file changes. |
| `./scripts/smoke/smoke-all.sh` | E2E smoke tests via Playwright. Tests landing, QC, Swipe. |
| `npx tsc --noEmit` | TypeScript type checking (no output files). Enforced pre-commit. |
| `npm run lint` | Linting: Biome, ESLint, Stylelint, html-validate. |
| `npm run lint:fix` | Auto-fix linting issues. |

## Coverage enforcement

Coverage floors are stored in `documentation/script-coverage.tsv` and enforced by
`scripts/check-coverage.mjs`. Runs on pre-commit and in CI.

**Rules:**

- **Pre-existing files:** must not regress below their current coverage. Failing the check blocks commit.
- **New files:** must debut at 100% coverage. Instrument test file with new source file, both added to git together.

**Why:** Prevents quality backslide. Makes coverage trends visible in commit history.

## Mocking patterns

### Mocking @nanalogue/node

Use `vi.mock()` to replace the native addon with test doubles.

**Reference:** `src/lib/qc-data-loader.test.ts`

**Pattern:**
```typescript
vi.mock("@nanalogue/node", () => ({
    readInfo: vi.fn().mockResolvedValue([
        { seq_len: 1000, align_len: 950, contig: "chr1", pos: 100 },
    ]),
}));
```

Return minimal valid objects. Test the loader's validation and transformation logic, not the native call.

### Mocking the LLM

Use `http.createServer()` to mock the OpenAI-compatible endpoint.

**Reference:** `src/lib/chat-orchestrator-test-utils.ts`

**Pattern:**
```typescript
const mockServer = createMockServer();
const endpoint = `http://localhost:${port}/v1`;
// Requests to endpoint go to mock; responds with canned Python code
```

Mock `POST /v1/chat/completions`. Return `{ choices: [{ message: { content: "python code" } }] }`.
Test the orchestrator's orchestration loop, error handling, and context management — not the LLM itself.

## What to test

**Tested heavily:**

- Pure functions in `src/lib/` (parsers, loaders, orchestrators).
- IPC channels in `src/modes/` and `src/preload.ts`.
- Renderer form state and interaction in `src/renderer/`.

**Tested lightly or not at all:**

- Electron main process startup (`src/main.ts`). Hard to unit-test; covered by smoke tests instead.
- Forked child process (`src/exit-watchdog.ts`). Hard to unit-test; low risk.

## Test file locations

- Unit tests live next to source: e.g. `src/cli.ts` has a corresponding `src/cli.test.ts`.
- Shared test utilities: `src/lib/chat-orchestrator-test-utils.ts` (used by multiple test files).
- Mock fixtures: `tests/fixtures/` (e.g., canned LLM responses).
- Smoke tests: `scripts/smoke/`.

## Before committing

```bash
npm run build          # must succeed
npx tsc --noEmit       # must produce no errors
npm test               # all tests must pass
npm run lint           # no lint errors
npm run lint:fix       # auto-fix what can be fixed
```

Then run AI reviewers if available (optional but recommended for doc/architecture changes):
```bash
coderabbit review --prompt-only -t uncommitted
codex review --uncommitted
```
