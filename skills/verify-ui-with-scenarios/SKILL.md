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

## 3. Cover new states

When the change adds a state (a new error message, an empty list, a permission variant), add a scenario for it, extending an existing one, and give it a `ready` selector. Run `npx state-scenarios validate src/scenarios --rules src/scenario-rules.ts`.

To find gaps, run:

```bash
npx state-scenarios suggest src/scenarios --src src --schema src/scenario.schema.json
```

It lists candidate UI states, marks which scenarios cover them, and drafts scenarios for the gaps into `src/scenarios/proposed/`. To capture a state from the real backend, open the app with `?scenario-record`, run the flow, and save it from the panel.

Review each draft from `suggest`, then move the ones you keep into `src/scenarios/`. It needs `ANTHROPIC_API_KEY`; `--model` with `ANTHROPIC_BASE_URL` targets another Anthropic-compatible endpoint.

## 4. In Playwright tests

```ts
import { openInlineScenario, openScenario, unhandledRequests } from 'state-scenarios/playwright';

await openScenario(page, 'orders-empty');
expect(await unhandledRequests(page)).toEqual([]);
```

`openScenario` runs in strict mode, so a missing fixture fails with a 501 instead of reaching a real backend.
