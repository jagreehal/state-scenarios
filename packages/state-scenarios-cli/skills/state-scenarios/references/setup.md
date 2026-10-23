# Setup

## Install and init

```bash
npm i state-scenarios zod msw          # msw only when scenarios mock the network
npm i -D state-scenarios-cli @playwright/test
npm i state-scenarios-react            # useScenarioState, for component state (React, Preact)

npx state-scenarios init src/scenarios
```

`init` writes `src/scenarios/default.json` and `src/scenario.schema.json`, prints a wiring snippet,
installs these skills into `.agents/skills/` (and `.claude/skills/`), and registers the MCP server
in `.mcp.json`. It never edits your source files. `--no-skills` skips the skills and the MCP server.

Vite: serve the MSW worker and let the panel save into the project.

```ts
// vite.config.ts
import { msw } from 'msw/vite';
import { stateScenarios } from 'state-scenarios/vite';

export default { plugins: [msw({ mode: 'worker-only' }), stateScenarios({ dir: 'src/scenarios' })] };
```

Without the MSW Vite plugin: `npx msw init public`.

## Wire the runtime before render

```ts
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { mountPanel } from 'state-scenarios/panel';

if (import.meta.env.DEV) {
  const session = await startScenarios({
    scenarios: Object.values(
      import.meta.glob<ScenarioInput>('/src/scenarios/*.json', { eager: true, import: 'default' }),
    ),
    adapters: [], // see below
    refresh: () => queryClient.resetQueries(), // when scenarios mock the network
  });
  mountPanel(session, { schemaPath: '../scenario.schema.json' });
}
// then create the router and render
```

- `await` it before rendering. The first fetches must already hit the scenario's mocks.
- Routers read the URL once, when they're created. If a module creates the router as soon as it
  is imported (`export const router = createBrowserRouter(...)`), a static import runs before the
  session. Import it after:

  ```ts
  // main.ts: start the session first, then import the router
  import type { ScenarioInput } from 'state-scenarios';

  if (import.meta.env.DEV) {
    const { startScenarios } = await import('state-scenarios');
    await startScenarios({
      scenarios: Object.values(
        import.meta.glob<ScenarioInput>('/src/scenarios/*.json', { eager: true, import: 'default' }),
      ),
    });
  }

  const { router } = await import('./routing/router'); // created now, with the scenario's URL
  ```

- Next.js (App Router): start it from a `'use client'` wrapper in the root layout and render
  children once it resolves. The package README has the component and the save route.
- Apps that already run MSW: start your worker and pass it as `worker`. See topic `network`.

## Connect app state

Mock the network first. Add adapters for state no response can produce, such as a panel left open
or cached data during a refetch.

| State lives in | Connect with                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| TanStack Query | `tanstackQuery(queryClient)` from `state-scenarios/tanstack-query`                                           |
| Zustand        | `zustandAdapter(store, { schema: StoreSchema.partial() })` from `state-scenarios/zustand`                    |
| Redux          | `withScenarioState(rootReducer, StateSchema)`, then `reduxAdapter(store)`                                    |
| XState         | `xstateAdapter(machine, { context: ContextSchema })`, then `createActor(machine, { snapshot: xs.snapshot })` |
| Cookies        | `cookiesAdapter()` from `state-scenarios/cookies`                                                            |
| Web storage    | `storageAdapter()`, or `storageAdapter({ area: 'session' })`, from `state-scenarios/storage`                 |
| A component    | `useScenarioState('page', state, (s) => dispatch({ type: 'set', state: s }), Schema)`                        |

Pass a Zod schema wherever an adapter accepts one: invalid scenario state is then rejected before
anything changes. `scenarioJsonSchema({ state: { key: Schema } })` regenerates the editor schema
with typed `state`.

## An app you can't change

Leave the app's code alone and pick one:

- `stateScenarios({ dir, inject: { handlers: ['@/mocks/*.handlers.ts'] } })` from
  `state-scenarios/vite`, in a Vite config of your own that extends the app's. The page starts
  scenarios, MSW and the panel before the app's entry runs, so links, the panel and the CLI work.
- `routeScenario(page, { url, scenario, scenarios, handlers })` from `state-scenarios/playwright`
  answers the API from the test. Use it when you only need Playwright.

Both set `now`, `state.cookies`, `state.localStorage` and `state.sessionStorage` before the app
starts. The README's "An app you can't change" section has full examples.

## Check

`npx state-scenarios doctor src/scenarios --base-url http://localhost:5173` passes. Opening
`/?scenario=default` sets `<html data-scenario="default">`.
