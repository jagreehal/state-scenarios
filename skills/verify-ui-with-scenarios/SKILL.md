---
name: verify-ui-with-scenarios
description: >
  Verify a UI change across every named application state in a repo that uses
  state-scenarios: open each scenario, screenshot it, and catch unmocked
  requests, uncaught errors and console errors. Also drafts scenarios for UI
  states nobody covers yet. Use after changing components, styles or data
  handling, before opening a PR, or when asked which states the UI is missing.
---

# Verify a UI change with scenarios

The repo already has `state-scenarios` set up: scenario files (often `src/scenarios/*.json`) and a dev server that runs `startScenarios`.

## 1. Run every scenario

Start the dev server, then:

```bash
npx state-scenarios shoot src/scenarios --base-url http://localhost:5173 --out .scenario-shots --json
```

For each scenario, `shoot` waits for the `ready` selector, saves `<name>.png`, and reports:

- `unhandled`: requests the scenario didn't mock. Add a `network` entry for each, or extend a scenario that has one.
- `pageErrors` and `consoleErrors`: exceptions and `console.error` calls during render.
- `error`: the scenario never became ready. Check its `ready` selector against the UI.

It exits non-zero when any scenario has a problem. Limit a run with `--only name,name`.

## 2. Look at the screenshots

Open the PNGs for scenarios your change touches, plus loading, empty and error states. Attach the relevant ones to the PR as evidence.

## 3. Cover new states (prefer capture)

When the change adds a state, **capture it from the running app**, the same way a person would:

1. Open the app with `?scenario-record` if you need real network fixtures.
2. Drive the UI into the state.
3. Panel → **Save as scenario** → **Mark ready** (or accept a suggestion) and confirm the line under Ready says it matches → choose **Extends** → **Save to src/scenarios** (or **Download JSON** into `src/scenarios/`).
4. Or, from Playwright/agent code, use `captureScenario`, `diffScenario`, `selectorForElement` and `checkReadySelector` from `state-scenarios` to build the same `{ flat, forCatalog }` shape, then write `forCatalog` to disk.
5. `npx state-scenarios validate src/scenarios --rules src/scenario-rules.ts`

Use `suggest` for ideas. Its drafts land in `src/scenarios/proposed/` and usually need fixture or `ready` edits:

```bash
npx state-scenarios suggest src/scenarios --src src --schema src/scenario.schema.json
npx state-scenarios promote src/scenarios   # after review; --dry-run to preview
```

Record + Mark ready gives you real network fixtures. `promote` checks names, resolves each draft and runs the rules before it moves a file.

## 4. In Playwright tests

```ts
import { openInlineScenario, openScenario, unhandledRequests } from 'state-scenarios/playwright';

await openScenario(page, 'orders-empty');
expect(await unhandledRequests(page)).toEqual([]);
```

`openScenario` runs in strict mode, so a missing fixture fails with a 501 instead of reaching a real backend.
