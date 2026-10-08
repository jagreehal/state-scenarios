# state-scenarios

Put a running app into any state from a URL, with no database, seed scripts or backend. You can inspect that state, edit it live, save it as a named scenario, and share a link that reproduces it, network and cache included.

A **scenario** is a JSON file that describes one application state: what the API returns, which URL params are set, and, when the network can't express it, what the store or cache holds. One file drives four things:

- **the dev panel**: QA, design and product open `/app?scenario=server-error`, switch states in place, edit live state, and save what they see as a new scenario
- **Playwright**: `await openScenario(page, 'server-error')`
- **visual regression**: one baseline per scenario
- **agents**: `state-scenarios shoot` opens every scenario and returns screenshots plus the requests each one didn't mock

`state-scenarios suggest` asks a model to draft scenarios. It speeds up writing them; the JSON format carries the value.

```json
{
  "$schema": "../scenario.schema.json",
  "name": "flaky-then-recovers",
  "extends": "default",
  "description": "First call fails; Retry succeeds",
  "tags": ["error", "sequence"],
  "url": { "q": "Fr", "region": null },
  "network": [
    {
      "method": "GET",
      "path": "/api/countries",
      "sequence": [
        { "status": 500, "body": { "message": "Upstream timeout" } },
        { "status": 200, "delay": 400, "body": [{ "name": "France" }] }
      ]
    }
  ],
  "state": { "tanstack-query": [{ "queryKey": ["countries"], "data": [] }] },
  "ready": "text=Upstream timeout"
}
```

| Field                 | Meaning                                                                                                                                                                                                                                                       | Inherited through `extends`?                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `network[]`           | `method`, `path` (MSW syntax, `:params`), optional `query`, then one of `response`, `sequence` or `remove: true`. A response sends `body` as JSON or `text` as text (an HTML error page, say). `delay: "infinite"` holds the request open for loading states. | A child entry **replaces** the parent's entry with the same method, path and query. `remove` drops it. |
| `path`                | App route the scenario opens at, e.g. `/orders/42`. Links, the panel, `shoot` and `openInlineScenario` go there; "Save as scenario" records the current route.                                                                                                | Yes.                                                                                                   |
| `url`                 | Query params the app starts with. Params already in the URL win, so a reload keeps in-app navigation.                                                                                                                                                         | Merged; `null` removes a param.                                                                        |
| `state`               | Per-adapter state, as JSON. Reach for it when the network can't produce a state.                                                                                                                                                                              | Deep-merged; `null` removes a key.                                                                     |
| `ready`               | A Playwright selector that turns visible once the UI shows this state. Tests, `shoot` and agents wait for it.                                                                                                                                                 | No. Each state renders differently.                                                                    |
| `description`, `tags` | For people and the panel.                                                                                                                                                                                                                                     | No                                                                                                     |

Three layers check a scenario. Zod checks its **shape** at runtime and JSON Schema checks it in your editor; a test keeps the two in agreement. **Rules** from `defineScenarioRules` check business invariants whenever a scenario resolves. Whether production can **reach** the state is your call: a valid scenario can describe something your backend never sends.

## Install

```sh
pnpm add state-scenarios zod msw          # msw only when scenarios mock the network
pnpm add state-scenarios-react            # useScenarioState for component state
pnpm add -D state-scenarios-cli           # validate, list, shoot, suggest
```

## Use

```ts
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { mountPanel } from 'state-scenarios/panel';
import { tanstackQuery } from 'state-scenarios/tanstack-query';
import { rules } from './scenario-rules';

if (import.meta.env.DEV) {
  const session = await startScenarios({
    scenarios: Object.values(
      import.meta.glob<ScenarioInput>('./scenarios/*.json', { eager: true, import: 'default' }),
    ),
    adapters: [tanstackQuery(queryClient)],
    rules,
    refresh: () => queryClient.resetQueries(), // lets network-only switches happen in place
  });
  mountPanel(session);
}
// then create the router and render the app: routers read the URL once, when created
```

State that lives inside a component (`useReducer`, `useState`, `useMachine`) connects with one hook. The Preact example wires both of its state engines this way:

```ts
import { useScenarioState } from 'state-scenarios-react'; // Preact via preact/compat

const [state, dispatch] = useReducer(reducer, initial);
useScenarioState('page', state, (page) => dispatch({ type: 'set', state: page }), PageStateSchema);
```

On mount the hook applies the active scenario's `state.page`. The panel shows `state` live, and your edits in the panel go back through `dispatch`. Pass a Zod schema and `apply` receives typed state; leave it out and `apply` receives the scenario's JSON. In production, with no session, the hook does nothing.

The MSW Vite plugin serves the worker: `msw({ mode: 'worker-only' })` (see `examples/demo-react/vite.config.ts`). MSW loads when a scenario mocks the network or strict mode is on, so state-only setups like the Preact example never start a worker.

**Already using MSW?** Start your worker and pass it in: `startScenarios({ worker, ... })`. Requests go to the scenario's handlers first, then yours, then the strict-mode catch-all. `destroy()` puts your handlers back. state-scenarios passes `workerOptions` to `start()` when it starts its own worker.

**Cleanup:** `session.destroy()` unsubscribes adapters, drops listeners and queued switches, and stops the worker it started (or restores yours). Call it on HMR or unmount; `panel.remove()` unsubscribes the panel. The session logs and skips a listener that throws, so one failing subscriber can't block the others or fail a switch.

**Panel options:** `mountPanel(session, { position: 'bottom-left', zIndex: 1000, theme: 'dark' })`. Pick a corner that keeps clear of chat widgets. `theme` defaults to `auto`, which follows the OS.

### Selecting a scenario

- `?scenario=<name>` opens a catalog scenario. `?scenario=a,b` combines several; later names win, as with `extends`.
- `#scenario-data=<json>` opens an inline scenario. The hash never reaches a server, so big fixtures don't hit URL limits. Inline links carry the **flattened** scenario, so they work without the recipient's catalog.
- With neither, the tab's last selection applies (so navigation that drops the query keeps the scenario), then `defaultScenario`. Without those, the app runs untouched. Adapters stay connected either way, so you can inspect and capture the plain app too.
- `?scenario=` (empty) resets.

### Switching

`session.open(name)`, `session.openInline(scenario)` and a click in the panel switch **in place** when they can:

1. The session validates all connected adapter state before choosing between in place and reload. A rejected switch changes nothing and never navigates.
2. If the scenario mocks the network, the session rebuilds MSW's handlers and starts `refresh`, even when you reopen the same scenario. Sequences replay from the start and the app refetches edited network data, so reopening a preset restores it. The session doesn't await `refresh`, so a scenario whose requests never answer still switches.
3. Connected adapters receive the new state.

Switches run one at a time. A switch superseded while it waits never runs, so the latest one wins.

The page reloads instead when:

- the app's current query params (a search you typed, say) differ from the scenario's `url`, because URL-driven UI resets on a reload;
- the previous scenario set state the new one doesn't cover, since nothing can un-apply state;
- no connected adapter can receive the new state;
- the scenario mocks the network but you gave no `refresh`, so the app couldn't refetch.

### The panel

- **Scenarios:** click to switch, or **+** to combine with the current one.
- **Live state:** one JSON editor per connected adapter. It follows the app while open and leaves alone whatever you're typing. **Apply** pushes your edit into the app.
- **Save as scenario:** a name plus the current URL params, the active network fixtures, and every adapter's live state, including the query cache and any refresh in progress. **Copy link** gives a self-contained link; **Download JSON** gives a file to commit to `scenarios/`. The panel checks the rules first.
- **Edit current scenario:** edit the scenario as written, `extends` and all, and apply it.
- Requests the scenario didn't cover appear in the panel.

**Strict mode** (`strict: true`, or `?scenario-strict`, which links and in-place switches keep) answers any request the scenario doesn't cover with a 501, so it never reaches a real backend. Assets and page loads pass; list deliberate live requests in `allow`. `unhandledRequests(page)` returns the uncovered requests in either mode. `openScenario` and `openInlineScenario` run strict by default.

**Readiness:** the session sets `<html data-scenario="name" data-scenario-ready="selector">` once the scenario is active and async adapters have finished. The Playwright helpers wait for both, so a screenshot captures the state itself, deliberate loading states included.

### Adapters

| Import                           | State key                                        | Wiring                                                                                                                    |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `state-scenarios-react`          | yours                                            | `useScenarioState(key, state, apply, schema?)` in a component                                                             |
| `state-scenarios/tanstack-query` | `tanstack-query`: `[{ queryKey, data, stale? }]` | `tanstackQuery(queryClient)`                                                                                              |
| `state-scenarios/zustand`        | `zustand`: partial state                         | `zustandAdapter(store, { schema: StoreSchema.partial() })`                                                                |
| `state-scenarios/redux`          | `redux`: deep-merged                             | wrap the root reducer with `withScenarioState(reducer, StateSchema)`, then `reduxAdapter(store)`                          |
| `state-scenarios/xstate`         | `xstate`: `{ value, context }`                   | `const xs = xstateAdapter(machine, { context: ContextSchema })`, then `createActor(machine, { snapshot: xs.snapshot })`   |
| `state-scenarios/cookies`        | `cookies`: `{ name: value }`                     | `cookiesAdapter()`. Set before render, so cookie auth gates let the scenario in; overwrites real cookies of the same name |

Scenario state is JSON, and your app's types aren't. A schema bridges them: a `TypedAdapter` has `{ key, schema, apply(state: T) }` and receives decoded state, while a `JsonAdapter` has `{ key, apply(state: Json) }` and receives the JSON as written. Both can add `read()`, which returns the live state as JSON for the panel, and `subscribe(onChange)`. Set `fromLinks: false` on an adapter whose state outlives the scenario, such as a cookie the real backend reads. Catalog scenarios then set it and inline links (`#scenario-data=`) skip it. The cookies adapter does this. Zustand, Redux and XState require a schema because a store's type can't come from JSON on trust.

Pass adapters that exist before render to `startScenarios`. Connect the rest later with `session.connect(adapter)`, which returns `{ update, disconnect }` for state you push rather than read. A schema also feeds `scenarioJsonSchema({ state })`, so editors know each adapter's shape (see `examples/demo-react/schema.ts`).

`xstateAdapter` hands the actor a snapshot it starts from, so switching to another `state.xstate` reloads the page. Connect a running actor with `useScenarioState` to switch in place.

Seeded TanStack entries start **fresh** and won't refetch over the scenario's data. `"stale": true` refetches on mount, for example to show a background refresh.

### Playwright

```ts
import { openInlineScenario, openScenario, unhandledRequests } from 'state-scenarios/playwright';

await openScenario(page, 'server-error');
await openInlineScenario(page, { name: 'one-off', extends: 'default', url: { q: 'Fr' } });
expect(await unhandledRequests(page)).toEqual([]);
```

`{ path: '/orders/42' }` opens a route. `{ panel: false }` hides the dev panel before the app renders, for screenshots and videos in product docs; a later `openScenario` without it shows the panel again. [`examples/docs-walkthrough`](examples/docs-walkthrough) builds Markdown, GIFs and video from scenarios with [executable-stories](https://www.npmjs.com/package/executable-stories-playwright).

## CLI

```sh
pnpm state-scenarios validate examples/demo-react/scenarios --rules examples/demo-react/rules.ts      # CI: everything resolves and passes rules
pnpm state-scenarios list examples/demo-react/scenarios --base-url http://localhost:5173 [--json]
pnpm state-scenarios shoot examples/demo-react/scenarios --base-url http://localhost:5173 --out shots [--json]
pnpm state-scenarios suggest examples/demo-react/scenarios --src examples/demo-react --rules examples/demo-react/rules.ts --schema examples/demo-react/scenario.schema.json
```

- **`shoot`** suits an agent checking a UI change. It opens every scenario (or `--only a,b`), waits for `ready`, saves a screenshot, and reports unmocked requests, uncaught exceptions and `console.error` calls. It exits non-zero on any of them. It ignores the browser's "Failed to load resource" logs, which error scenarios cause on purpose.
- **`suggest`** sends your source files and a summary of the catalog to a model; fixture bodies go as a count and a first item. The model lists **candidate** UI states, marks which existing scenarios cover them, and drafts scenarios for the gaps. The CLI rejects drafts that fail `--schema` (adapter state shapes included), the rules or an `extends` lookup, and says why. Valid drafts land in `<dir>/proposed/` for review, a folder `*.json` globs don't load.
  - Default model: `claude-opus-5-5`, with server-side refusal fallback. It needs `ANTHROPIC_API_KEY` or `ant auth login`.
  - Other models: `--model` (or `STATE_SCENARIOS_MODEL`), with `ANTHROPIC_BASE_URL` pointing at an Anthropic-compatible proxy. `--env-file` loads those variables. The CLI drops Claude-only options for other models, and when a proxy rejects structured output it retries, asking for plain JSON.

## Packages

| Package                                                   | What                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`state-scenarios`](packages/state-scenarios)             | Core: schema, runtime, panel, Playwright helper, store adapters (`/tanstack-query`, `/zustand`, `/redux`, `/xstate`) |
| [`state-scenarios-react`](packages/state-scenarios-react) | `useScenarioState` for component state (React, Preact)                                                               |
| [`state-scenarios-cli`](packages/state-scenarios-cli)     | `state-scenarios validate · list · shoot · suggest`                                                                  |

Vue and Svelte hooks would be sibling packages (`state-scenarios-vue`, `state-scenarios-svelte`). The rest of the library has no framework dependency.

## Examples

- **`examples/who-speaks-what-preact/`** runs on Preact 11, XState 5, preact-iso and Tailwind 4. The same page state lives in a `useReducer` (`/`) and an XState machine (`/xstate`); each route connects with one `useScenarioState` call and a Zod schema, and `src/scenarios.ts` defines its page presets as scenarios. It mocks no network, so MSW never loads.
- **`examples/demo-react/`** rebuilds the same app in React around an API. Its 13 scenario files cover network fixtures, sequences, cache seeding, strict mode and inheritance.

## Agent skills

`skills/` holds two skills for coding agents:

- **`add-state-scenarios`** wires the library into an app: scenario files, the runtime, adapters and the editor schema.
- **`verify-ui-with-scenarios`** checks a UI change across every scenario with `shoot`, and drafts scenarios for uncovered states with `suggest`.

## Development

```sh
pnpm install
pnpm --filter demo-react dev             # demo, panel in the bottom-right corner
pnpm --filter who-speaks-what-preact dev # Preact + XState example
pnpm build            # all packages (tsup + tsc declarations, via turbo)
pnpm lint             # oxlint (type-aware, anti-slop rules) + dprint check
pnpm lint:fix         # autofix, then format
pnpm typecheck
pnpm test             # unit: schema, inheritance, rules, JSON Schema ↔ Zod, adapters, runtime, suggest
pnpm test:e2e         # Playwright: demo, the save-and-share workflow, the Preact app, visual baselines
pnpm test:e2e:update  # accept intended visual changes
pnpm schema           # regenerate examples/demo-react/scenario.schema.json (a test fails if it's stale)
pnpm quality          # build, lint, typecheck, test, test:e2e
pnpm changeset        # describe a change; `pnpm release` builds and publishes
```

Lint runs oxlint with type-aware rules and the vendored [anti-slop](tools/oxlint/anti-slop/UPSTREAM.md) plugin at `error`, with `--deny-warnings`. The rules push unknown input through a schema at its boundary and forbid unchecked type assertions, so the code above has no `as` casts outside `as const`. dprint formats TypeScript, JSON and Markdown.

## Known limits

- **Visual baselines are per-OS.** The repo holds macOS (`*-darwin.png`) and Linux (`*-linux.png`) baselines; the Linux ones come from the Playwright Docker image, matching CI.
- **Strict mode treats any path with a file extension as an asset** (MSW's `isCommonAssetRequest`), so `GET /api/data.json` passes through. List such endpoints in the scenario, or watch `unhandledRequests`.
- **Inline links carry the whole flattened scenario.** Large fixtures, or a captured 2,480-country page state, make long links. The hash has no server limit, but pasting one gets unwieldy; use **Download JSON** instead.
- **In-place switching can't undo state.** When the new scenario doesn't cover a key the previous one set, the page reloads.
