---
name: add-state-scenarios
description: >
  Add state-scenarios to a web app so any UI state opens from a URL: mocked API
  responses, URL params and store or cache state, plus a dev panel to switch,
  edit and save states. Use when the user wants to demo or test loading, empty,
  error or edge-case states without a backend, replace a hand-rolled debug
  panel, share a link that reproduces a bug, or wire Playwright to named states.
---

# Add state-scenarios to an app

A scenario is a JSON file describing one UI state. `startScenarios` reads the active one from the URL, mocks the network with MSW when the scenario needs it, and applies state through adapters. Await it before the app renders.

## 1. Install and init

```bash
pnpm add state-scenarios msw zod
pnpm add -D state-scenarios-cli @playwright/test   # CLI and Playwright helpers
pnpm add state-scenarios-react                      # for component state (React or Preact)

npx state-scenarios init src/scenarios
```

`init` writes `src/scenarios/default.json` and `src/scenario.schema.json`, then prints a wiring snippet. It does not patch your entrypoint.

In `vite.config.ts`, serve the MSW worker and let the panel save into the project: `plugins: [msw({ mode: 'worker-only' }), stateScenarios({ dir: 'src/scenarios' })]`, from `msw/vite` and `state-scenarios/vite`.

## 2. Wire the runtime before render

Paste the snippet from `init` (or the block below). Keep the `import.meta.env.DEV` guard so production bundles skip the runtime.

```ts
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { mountPanel } from 'state-scenarios/panel';
import { tanstackQuery } from 'state-scenarios/tanstack-query';

if (import.meta.env.DEV) {
  const session = await startScenarios({
    scenarios: Object.values(
      import.meta.glob<ScenarioInput>('./scenarios/*.json', { eager: true, import: 'default' }),
    ),
    adapters: [tanstackQuery(queryClient)],
    refresh: () => queryClient.resetQueries(),
  });
  mountPanel(session, { schemaPath: '../scenario.schema.json' });
}
```

In Next.js (App Router), start the runtime from a `'use client'` wrapper in the root layout instead, and render children once it resolves; the README's Next.js section has the component, plus the `app/%5F%5Fstate-scenarios/save/route.ts` route (`createSaveRoute` from `state-scenarios/next`) that lets the panel save into the project. Pass `refresh` whenever scenarios mock the network, so switching happens without a reload. If the app already runs MSW, pass its started worker as `worker`.

## 3. Capture the first scenario

1. Open the app with `?scenario-record` (against the real backend, or with your existing MSW handlers).
2. Click through the flow until the UI shows the state you want.
3. Open the panel → **Save as scenario** → **Mark ready** (click the distinctive UI) or accept a suggestion.
4. Check the line under **Ready** says it matches, choose a base to **Extends** (`default` when present) → **Save to src/scenarios** (or **Download JSON** without the Vite plugin or Next.js route).
5. **Copy link** stays a self-contained share link (flattened); Download is the catalog file.

Edge cases after `default` exists usually only override one `network` entry plus `ready`:

```json
{
  "$schema": "../scenario.schema.json",
  "name": "orders-empty",
  "extends": "default",
  "description": "No orders yet",
  "network": [{ "method": "GET", "path": "/api/orders", "response": { "body": [] } }],
  "ready": "text=No orders yet"
}
```

- `response.body` sends JSON; `response.text` sends text. `delay: "infinite"` holds a request open for loading states. `sequence` returns successive responses (fail, then succeed on retry).
- A child's network entry replaces the parent's entry with the same method, path and query; `"remove": true` drops it. In `url` and `state`, `null` removes an inherited key.

## 4. Connect app state

Prefer the network: a scenario that mocks the API exercises the real fetching and error handling. Add state only for what the network can't produce, such as a filter panel left open or cached data during a refetch.

| State lives in                                       | Connect with                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| TanStack Query                                       | `tanstackQuery(queryClient)`                                                                                      |
| Zustand                                              | `zustandAdapter(store, { schema: StoreSchema.partial() })`                                                        |
| Redux                                                | `withScenarioState(rootReducer, StateSchema)`, then `reduxAdapter(store)`                                         |
| XState actor                                         | `xstateAdapter(machine, { context: ContextSchema })`, then `createActor(machine, { snapshot: adapter.snapshot })` |
| A component (`useState`, `useReducer`, `useMachine`) | `useScenarioState('page', state, (page) => dispatch({ type: 'set', state: page }), PageStateSchema)`              |

Pass a Zod schema wherever the adapter accepts one: it decodes the scenario's JSON into the app's type and rejects bad state before anything changes.

## 5. Tighten the editor schema

If adapters need typed `state`, regenerate with `scenarioJsonSchema({ state: { 'tanstack-query': tanstackQueryState } })` into `src/scenario.schema.json` so editors autocomplete scenario files.

## Check

- `npx state-scenarios validate src/scenarios` passes.
- Opening `/?scenario=<name>` shows the state, and `<html data-scenario="<name>">` is set.
- The panel lists no uncovered requests for each scenario.
