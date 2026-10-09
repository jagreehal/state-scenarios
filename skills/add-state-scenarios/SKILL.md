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

## 1. Install

```bash
pnpm add state-scenarios msw zod
pnpm add -D state-scenarios-cli @playwright/test   # CLI and Playwright helpers
pnpm add state-scenarios-react                      # for component state (React or Preact)
```

In `vite.config.ts`, serve the MSW worker: `plugins: [msw({ mode: 'worker-only' })]` from `msw/vite`.

## 2. Write scenarios

Create `src/scenarios/*.json`. Start with a `default` scenario that mocks every endpoint the screen calls, then build edge cases on it with `extends`:

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
- Set `ready` to a Playwright selector that only appears once the state renders. Tests and `shoot` wait for it.
- To capture real responses, open the app with `?scenario-record`, click through the flow against the real backend, then use the panel's "Save as scenario". The saved file mocks every JSON call you made, with repeated calls as a `sequence`.

## 3. Start the runtime before render

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
  mountPanel(session);
}
```

Keep the `import.meta.env.DEV` guard so production bundles skip the runtime. In Next.js (App Router), start the runtime from a `'use client'` wrapper in the root layout instead, and render children once it resolves; the README's Next.js section has the component. Pass `refresh` whenever scenarios mock the network, so switching happens without a reload. If the app already runs MSW, pass its started worker as `worker`.

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

## 5. Generate the editor schema

Export `scenarioJsonSchema({ state: { 'tanstack-query': tanstackQueryState } })` to `src/scenario.schema.json` so editors autocomplete scenario files, and point each file's `$schema` at it.

## Check

- `npx state-scenarios validate src/scenarios` passes.
- Opening `/?scenario=<name>` shows the state, and `<html data-scenario="<name>">` is set.
- The panel lists no uncovered requests for each scenario.
