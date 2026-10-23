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

| Field                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Inherited through `extends`?                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `network[]`           | `method`, `path` (MSW syntax, `:params`), optional `query`, then one of `response`, `sequence` or `remove: true`. A response sends `body` as JSON or `text` as text (an HTML error page, say). `delay: "infinite"` holds the request open for loading states.                                                                                                                                                                                                                                                                                                          | A child entry **replaces** the parent's entry with the same method, path and query. `remove` drops it. |
| `path`                | App route the scenario opens at, e.g. `/orders/42`. Links, the panel, `shoot` and `openInlineScenario` go there; "Save as scenario" records the current route.                                                                                                                                                                                                                                                                                                                                                                                                         | Yes.                                                                                                   |
| `url`                 | Query params the app starts with. Params already in the URL win, so a reload keeps in-app navigation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Merged; `null` removes a param.                                                                        |
| `handlers`            | Names of MSW handlers passed to `startScenarios({ handlers })`, such as the ones your unit tests use. They answer after `network[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Combined with the parent's.                                                                            |
| `viewport`            | `{ "width": 390, "height": 844 }`: the browser size `shoot` and `record` use for this scenario, e.g. a phone layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Yes.                                                                                                   |
| `state`               | Per-adapter state, as JSON. Reach for it when the network can't produce a state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Deep-merged; `null` removes a key.                                                                     |
| `ready`               | A Playwright selector that turns visible once the UI shows this state. Tests, `shoot` and agents wait for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | No. Each state renders differently.                                                                    |
| `steps`               | Clicks, typing and key presses taken once `ready` shows, for UI state no response produces: an open menu, a filled search. Each step is one of `{ "click": sel }`, `{ "fill": sel, "value": "…" }`, `{ "check": sel }`, `{ "select": sel, "value": "…" }`, `{ "press": "Enter", "on"?: sel }` or `{ "wait": sel }`, with `text=`, `role=` or CSS selectors. Events are the ones a person causes (pointer events included, and Enter submits a field's form). Tests, `shoot` and agents wait for them; a failing step is `STEPS_FAILED`. Never run from an inline link. | No.                                                                                                    |
| `now`                 | `"2031-03-31T09:00:00Z"`: the time the app sees when it starts, for due dates, expiry and "days left". The clock runs on from there. Switching to a different `now` reloads the page.                                                                                                                                                                                                                                                                                                                                                                                  | Yes.                                                                                                   |
| `description`, `tags` | For people and the panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | No                                                                                                     |

Three layers check a scenario. Zod checks its **shape** at runtime and JSON Schema checks it in your editor; a test keeps the two in agreement. **Rules** from `defineScenarioRules` check business invariants whenever a scenario resolves. Whether production can **reach** the state is your call: a valid scenario can describe something your backend never sends.

## Install

```sh
pnpm add state-scenarios zod msw          # msw only when scenarios mock the network
pnpm add state-scenarios-react            # useScenarioState for component state
pnpm add -D state-scenarios-cli           # validate, list, shoot, record, suggest
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

**Router created on import?** If a module calls `createBrowserRouter` (or similar) at its top level, a static `import` creates the router before the session has set the URL. Start the session first, then import the router dynamically:

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

The dynamic `import('state-scenarios')` inside the `DEV` check also keeps the library out of the production bundle.

**Signed in from the start.** Apps that check a stored token on startup (read a cookie, call a validate endpoint, decode the JWT it returns, fill stores from the claims) need two things in a scenario: the cookie, so the check runs, and a mocked validate response carrying a token. `unsignedJwt(claims)` builds that token. It is UTF-8 safe, so names in any script decode correctly. It's unsigned (`alg: "none"`), so anything that verifies signatures rejects it. Build the scenario in code:

```ts
import { type ScenarioInput, startScenarios, unsignedJwt } from 'state-scenarios';
import { cookiesAdapter } from 'state-scenarios/cookies';

const signedIn: ScenarioInput = {
  name: 'signed-in',
  state: { cookies: { session: 'scenario' } }, // so the app's startup check runs
  network: [{
    method: 'POST',
    path: '/api/auth/validate-token',
    response: {
      body: {
        token: unsignedJwt({ sub: 'user-1', name: 'Amara Okafor', roles: ['admin'], exp: 4102444800 }),
      },
    },
  }],
};

await startScenarios({ scenarios: [signedIn], adapters: [cookiesAdapter()] });
```

JSON scenarios then build on it with `"extends": "signed-in"`. Set `exp` in the future if the app checks expiry. Use whatever claim names your app reads.

**Reuse the MSW handlers your tests already have.** Pass them by name, then list names in a scenario. They answer after its `network[]` entries and before your worker's handlers:

```ts
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { statementsEmpty } from './test/handlers'; // the handlers your unit tests use

const scenarios: ScenarioInput[] = [
  { name: 'no-statements', handlers: ['statementsEmpty'], ready: 'text=No statements yet' },
];

await startScenarios({ scenarios, handlers: { statementsEmpty } });
```

```json
{
  "name": "no-statements",
  "extends": "signed-in",
  "handlers": ["statementsEmpty"],
  "ready": "text=No statements yet"
}
```

A value can be one handler or an array. A scenario that names an unknown handler fails to open and lists the known ones. `validate` in the CLI can't see handlers, so it checks only the JSON.

State that lives inside a component (`useReducer`, `useState`, `useMachine`) connects with one hook. The Preact example wires both of its state engines this way:

```ts
import { useScenarioState } from 'state-scenarios-react'; // Preact via preact/compat

const [state, dispatch] = useReducer(reducer, initial);
useScenarioState('page', state, (page) => dispatch({ type: 'set', state: page }), PageStateSchema);
```

On mount the hook applies the active scenario's `state.page`. The panel shows `state` live, and your edits in the panel go back through `dispatch`. Pass a Zod schema and `apply` receives typed state; leave it out and `apply` receives the scenario's JSON. In production, with no session, the hook does nothing.

The MSW Vite plugin serves the worker: `msw({ mode: 'worker-only' })` (see `examples/demo-react/vite.config.ts`). Add `stateScenarios({ dir: 'src/scenarios' })` from `state-scenarios/vite` so the panel saves scenarios into that folder. The plugin runs under `vite dev` and accepts same-origin requests to a loopback host (`localhost`, `127.0.0.1`, `[::1]`), which keeps cross-site pages and DNS rebinding out. From another device on `--host`, use Download JSON. MSW loads when a scenario mocks the network or strict mode is on, so state-only setups like the Preact example never start a worker.

**Already using MSW?** Start your worker and pass it in: `startScenarios({ worker, ... })`. Requests go to the scenario's handlers first, then yours, then the strict-mode catch-all. `destroy()` puts your handlers back. state-scenarios passes `workerOptions` to `start()` when it starts its own worker.

**Cleanup:** `session.destroy()` unsubscribes adapters, drops listeners and queued switches, and stops the worker it started (or restores yours). Call it on HMR or unmount; `panel.remove()` unsubscribes the panel. The session logs and skips a listener that throws, so one failing subscriber can't block the others or fail a switch.

**Panel options:** `mountPanel(session, { position: 'bottom-left', zIndex: 1000, theme: 'dark' })`. Pick a corner that keeps clear of chat widgets. `theme` defaults to `auto`, which follows the OS.

### Next.js (App Router)

state-scenarios runs in the browser, so in Next.js it covers **client** state only: the panel, `?scenario=` links, `url` params, cookies and `useScenarioState`. Server components and server actions run on the server, where MSW can't see them, so `network[]` mocks only `fetch` calls made from client components. To feed server-rendered data from a scenario, pass the data or action in as a prop and swap it in dev.

Start the session from a client component that wraps the app in your root layout (`<Scenarios>{children}</Scenarios>`). It holds the app back until the session has started, so the first client fetches already hit the scenario's mocks. `examples/next-app` is the working version.

```tsx
'use client';
import serverError from '@/scenarios/server-error.json'; // no import.meta.glob: list them
import { type ReactNode, useEffect, useState } from 'react';
import { ScenarioSchema, startScenarios } from 'state-scenarios';
import { cookiesAdapter } from 'state-scenarios/cookies';
import { mountPanel } from 'state-scenarios/panel';

// Imported JSON widens literals (`"GET"` becomes string): parse it into a typed scenario.
const scenarios = [serverError].map((s) => ScenarioSchema.parse(s));
const dev = process.env.NODE_ENV === 'development';
let started: Promise<void> | undefined; // Strict Mode runs effects twice

export function Scenarios({ children }: { children: ReactNode; }) {
  const [ready, setReady] = useState(!dev);

  useEffect(() => {
    if (!dev) return;
    started ??= startScenarios({ scenarios, adapters: [cookiesAdapter()] }).then((s) => {
      mountPanel(s);
    });
    void started.then(() => setReady(true));
  }, []);

  return ready ? children : null;
}
```

- In development the app renders after hydration, once the session has started, so the server-rendered HTML never shows the scenario. Cookies reach server components on the next request (`router.refresh()` or a reload).
- `url` params reach `useSearchParams` straight away; server components see them after a reload.
- If client components `fetch`, run `npx msw init public` so the worker is served from `/mockServiceWorker.js`.
- To let the panel save scenarios into the project, add `app/%5F%5Fstate-scenarios/save/route.ts` (`%5F` is an underscore; a plain `_` folder is private and never routes):

  ```ts
  import { createSaveRoute } from 'state-scenarios/next';

  export const { GET } = createSaveRoute({ dir: 'src/scenarios' });
  ```

  The route points the panel at a save server on `127.0.0.1`, so other machines on your network can't write files even though `next dev` listens on it. It answers 404 outside `next dev`. Next.js lists scenario imports by hand, so import a saved file to see it in the panel.

### An app you can't change

Two ways to use scenarios on an app that has no state-scenarios code, without editing it. Both suit an app whose API URL comes from config (point it at a host that doesn't resolve, such as `VITE_API_URL=http://api.invalid`, so anything unmocked fails loudly), and both reuse the MSW handlers its unit tests already have.

**The whole runtime, from a Vite config of your own.** Extend the app's config and add the plugin with `inject`. Before the app's entry runs, the page loads every scenario in `dir`, starts MSW with your handlers beneath them and mounts the panel. Links, the panel, recording and the CLI (`doctor`, `shoot`, `record`, `mcp`) all work. `state.cookies`, `state.localStorage` and `state.sessionStorage` are set before the app renders, for sign-in, themes and dismissed popups; `now` and `steps` work as in any app.

```ts
// e2e/vite.config.ts, next to your tests
import { stateScenarios } from 'state-scenarios/vite';
import { mergeConfig } from 'vite';
import app from '../apps/web/vite.config';

export default mergeConfig(app, {
  plugins: [
    stateScenarios({
      dir: `${import.meta.dirname}/scenarios`,
      inject: {
        // The base layer, first match first: each module's `handlers` (or default) export.
        // Every handler any of them exports can also be named in a scenario: "handlers": ["ordersEmpty"].
        handlers: ['@/mocks/handlers', '@/mocks/*.handlers.ts'],
        defaultScenario: 'signed-in',
        ignore: ['posthog', 'intercom', /google|gstatic/], // third parties scenarios don't care about
      },
    }),
  ],
});
```

Run the app's own Vite with it: `npx vite --config ../../e2e/vite.config.ts` from the app's folder. A unit-test suite's handler variants (`ordersEmpty`, `signInNeedsCode`, `checkoutError`) become states you can link to without copying a fixture. `inject` also takes `strict`, `allow`, `allowLinks` and `panel: false`. It only runs under `vite dev` unless you pass `build: true`, which ships the mocks, scenarios and panel in `vite build` for demo recordings and preview deploys: build into a folder of its own and never deploy it as the real app. Code, stylesheets, fonts and frames skip MSW in the worker and go straight to the network, so a handler such as `*/orders/:id` never answers a lazy chunk, and a cookie on `localhost` that MSW can't read never blanks the page.

**Playwright alone.** `routeScenario` answers the API from the test, as `page.route` does, so nothing runs in the page:

```ts
import { namedHandlers } from 'state-scenarios';
import { routeScenario } from 'state-scenarios/playwright';

const api = await routeScenario(page, {
  url: 'http://api.invalid/**',
  scenario: 'orders-empty', // or a scenario object
  scenarios, // the catalog it is named in or extends
  handlers, // your MSW handlers, beneath the scenario
  named: namedHandlers(await import('../src/mocks/orders.handlers')), // for "handlers": [...]
});
api.use(http.get('*/me', () => HttpResponse.json({ name: 'Alex' }))); // this test only
expect(api.unhandled).toEqual([]);
```

Requests no handler answers get a 501 and are listed in `unhandled`. `now`, `state.cookies`, `state.localStorage` and `state.sessionStorage` are set before the app's scripts run; other `state` needs adapters in the app. `steps` and the CLI need the runtime, so use the Vite config above for them.

### Selecting a scenario

- `?scenario=<name>` opens a catalog scenario. `?scenario=a,b` combines several; later names win, as with `extends`.
- `#scenario-data=<json>` opens an inline scenario. The hash never reaches a server, so big fixtures don't hit URL limits. Inline links carry the **flattened** scenario, so they work without the recipient's catalog. Anyone can write one, and it fakes API responses for whoever opens it, so inline links only open on localhost. Pass `startScenarios({ allowLinks: true })` on a staging or preview deploy that should open them, or `false` to refuse them everywhere.
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
- **Save as scenario:** name the state, set **Ready** (Mark ready and click the UI, or pick a suggestion), choose a base to **Extends** (defaults to `default` when present). Under **Ready** the panel says whether the selector matches on this page, using Playwright's matching rules, and outlines the match while the field has focus. **Save to src/scenarios** (with the Vite plugin below, or the Next.js route) writes the catalog file into your project, asking before it replaces one; **Download JSON** gives the same file as a download. That file holds overrides against the base, plus `ready` and optional `$schema` from `mountPanel(session, { schemaPath })`. **Copy link** embeds a self-contained flattened snapshot. Empty ready still copies a link; `shoot` and Playwright won't wait on the UI until you set one. The panel checks the rules first.
- **Edit current scenario:** edit the scenario as written, `extends` and all, and apply it.
- Requests the scenario didn't cover appear in the panel.

**Strict mode** (`strict: true`, or `?scenario-strict`, which links and in-place switches keep) answers any request the scenario doesn't cover with a 501, so it never reaches a real backend. Assets and page loads pass; list deliberate live requests in `allow`, such as images from a CDN.

**Third-party SDKs** (analytics, error reporting, captcha, chat widgets) are noise in a scenario. Add them to `ignore`: they are never reported as unhandled, and in strict mode they get an empty `204` instead of a `501`, so most SDKs stay quiet and don't retry.

```ts
import { type ScenarioInput, startScenarios } from 'state-scenarios';

declare const scenarios: ScenarioInput[];

await startScenarios({
  scenarios,
  allow: ['images.example-cdn.com'], // reaches the real network, even in strict mode
  ignore: [/posthog|segment|sentry|google-analytics|googletagmanager|recaptcha|hcaptcha|intercom/i],
});
```

The list above is a starting point; match the hosts your app calls. An SDK that still complains (some expect a JSON body) is better left off in scenarios: `if (!currentSession()?.active) analytics.init(...)`. Scripts the SDK loads (`.js` files) pass as assets either way. `unhandledRequests(page)` returns the uncovered requests in either mode. `openScenario` and `openInlineScenario` run strict by default.

**Recording** (`record: true`, or `?scenario-record`) lets requests reach your real backend and records every JSON response. Use the app, then click **Save as scenario**: the saved scenario carries the recorded responses as `network` entries, so it replays offline. Repeated calls to one endpoint become a `sequence` in call order, so "wrong code, then right code" replays as it happened. The saved scenario keeps the active scenario's mocks and adds the recorded responses after them. The panel button shows the recorded count. Recorded scenarios get committed, linked and pasted into chats, so recording keeps secrets out: values under secret-like keys (`password`, `secret`, `apiKey`, `token`, `sessionId` and similar) become `"[redacted]"`, and signed JWTs are re-issued unsigned with the same claims, so the app still decodes them and no server accepts them. Strings that look like Stripe, GitHub, AWS or Slack keys are redacted under any key. Inside any string, `Bearer` and `Basic` credentials, passwords in URLs and signed URL params are redacted too. Secret query params such as `key` and `access_token` are left out. Saving a scenario applies the same rules to adapter state and URL params. The console lists each redacted field. Personal data such as names and emails is kept, so record with a test account. `examples/auth-flows` records a sign-in against a stand-in backend and replays it in strict mode.

**Readiness:** the session sets `<html data-scenario="name" data-scenario-ready="selector">` once the scenario is active and async adapters have finished. The Playwright helpers wait for both, so a screenshot captures the state itself, deliberate loading states included.

### Adapters

| Import                           | State key                                           | Wiring                                                                                                                                              |
| -------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-scenarios-react`          | yours                                               | `useScenarioState(key, state, apply, schema?)` in a component                                                                                       |
| `state-scenarios/tanstack-query` | `tanstack-query`: `[{ queryKey, data, stale? }]`    | `tanstackQuery(queryClient)`                                                                                                                        |
| `state-scenarios/zustand`        | `zustand`: partial state                            | `zustandAdapter(store, { schema: StoreSchema.partial() })`                                                                                          |
| `state-scenarios/redux`          | `redux`: deep-merged                                | wrap the root reducer with `withScenarioState(reducer, StateSchema)`, then `reduxAdapter(store)`                                                    |
| `state-scenarios/xstate`         | `xstate`: `{ value, context }`                      | `const xs = xstateAdapter(machine, { context: ContextSchema })`, then `createActor(machine, { snapshot: xs.snapshot })`                             |
| `state-scenarios/cookies`        | `cookies`: `{ name: value }`                        | `cookiesAdapter()`. Set before render, so cookie auth gates let the scenario in; overwrites real cookies of the same name                           |
| `state-scenarios/storage`        | `localStorage` / `sessionStorage`: `{ key: value }` | `storageAdapter()` or `storageAdapter({ area: 'session' })`. Strings stored as written, anything else as JSON, before render; other keys left alone |

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

`showCursor(page)` draws a bright, pulsing arrow that follows Playwright's mouse and ripples on each click, because recorded videos don't show one. `{ color }` recolours it, `{ svg }` replaces it with your own, `{ size: 1.5 }` scales it, `{ halo: 40 }` sets the pulse's diameter (`false` for none), and `{ glide: true }` makes clicks, checks and typing (`fill`, `pressSequentially`, `selectOption`) wait for the cursor to reach their target. Call it before `openScenario`. `{ path: '/orders/42' }` opens a route. `{ panel: false }` hides the dev panel before the app renders, for screenshots and videos in product docs; a later `openScenario` without it shows the panel again. [`examples/docs-walkthrough`](examples/docs-walkthrough) builds Markdown, GIFs and video from scenarios with [executable-stories](https://www.npmjs.com/package/executable-stories-playwright).

## CLI

```sh
pnpm state-scenarios init                     # src/scenarios by default; also installs agent skills and the MCP server
pnpm state-scenarios doctor examples/demo-react/scenarios --base-url http://localhost:5173   # is it wired up? each problem with its fix
pnpm state-scenarios guide [topic]            # the agent skill for this version
pnpm state-scenarios mcp examples/demo-react/scenarios --base-url http://localhost:5173      # MCP server for coding agents
pnpm state-scenarios validate examples/demo-react/scenarios --rules examples/demo-react/rules.ts      # CI: everything resolves and passes rules
pnpm state-scenarios list examples/demo-react/scenarios --base-url http://localhost:5173 [--json]
pnpm state-scenarios shoot examples/demo-react/scenarios --base-url http://localhost:5173 --out shots [--json]
pnpm state-scenarios shoot examples/demo-react/scenarios --base-url http://localhost:5173 --no-panel --viewport 1440x900 --scale 2 --color-scheme dark --locale ja-JP --timezone Asia/Tokyo
pnpm state-scenarios record examples/demo-react/scenarios --base-url http://localhost:5173 --steps steps.ts --format mp4 [--element main]
pnpm state-scenarios suggest examples/demo-react/scenarios --src examples/demo-react --rules examples/demo-react/rules.ts --schema examples/demo-react/scenario.schema.json
pnpm state-scenarios promote examples/demo-react/scenarios   # move proposed/ into the catalog after review
```

- **`init`** creates `<dir>/default.json` and a sibling `scenario.schema.json`, then prints a copy-paste wiring snippet (no entrypoint patching). It also installs the agent skills (see [Coding agents](#coding-agents)) and registers the MCP server; `--no-skills` skips both. Then wire it up, open `?scenario-record`, Mark ready and save.
- **`doctor`** checks the setup one step at a time and prints the fix for each problem: scenarios parse, the dev server answers, the MSW worker is served, a scenario becomes active and shows its `ready` selector, the panel can save into the project, ffmpeg is there for `record`, and the skills and MCP server are installed. It's read-only. Run it first whenever something looks off.
- **`shoot`** suits an agent checking a UI change. It opens every scenario (or `--only a,b`), waits for `ready`, saves a screenshot, and reports unmocked requests, uncaught exceptions and `console.error` calls. It exits non-zero on any of them. It ignores the browser's "Failed to load resource" logs, which error scenarios cause on purpose. Each failed scenario gets `<out>/<name>.md`, a short page written for whoever fixes it: the codes, the link that reopens the state, whether the `ready` selector matched anything plus selectors on the page that would, unmocked requests as `network` entries ready to paste, and the errors.
  - For docs and marketing images: `--no-panel` hides the panel, `--viewport 1440x900` and `--scale 2` set size and sharpness, `--color-scheme dark` switches theme, and `--element <selector>` captures one component instead of the page. A scenario's `viewport` overrides `--viewport`, so a phone layout and a desktop one shoot in the same run.
  - For every market: `--locale` takes a BCP 47 tag (`en-GB`, `de-DE`, `ar-EG`, `hi-IN`, `pt-BR`) and `--timezone` an IANA zone (`Europe/Berlin`, `Asia/Kolkata`, `America/Sao_Paulo`). They set what `Intl`, `Date` and `navigator.language` report, so dates, numbers, currencies and right-to-left layouts render as people there see them. Without them, the browser uses the machine's settings, and shots differ between team members.
    `--compare <dir>` diffs each screenshot against an earlier run's (say, from the base branch) and writes `<out>/<name>.diff.png` for each state that changed: before, after and the changed pixels in red. States are reported `changed`, `same`, `new` or `removed`; diffs don't fail the run.
- **`affected`** lists the scenarios a branch's changes (committed, uncommitted and new files since `--base`, default `main`) can affect, each with why: its scenario file changed, it extends one that did, a scenario map row's Source column covers a changed file, a changed file mentions an endpoint it mocks, or a changed file sits under a folder named like its route. It ends with an `--only` list for `shoot`, and names changed source files nothing pointed at. `--src` limits it to the app's folders.
- **`coverage`** reads the scenario map that `/create-scenario-map` writes and counts its states: covered, missing and can't mock. It exits 1 when a row claims a scenario that doesn't exist, and lists scenarios no row mentions.
- **`publish <files…> --folder pr-42`** commits files to a `scenario-shots` branch with git plumbing, without touching the checkout, pushes it, and prints a Markdown image link per file, pinned to that commit. `gh` can't upload images to a PR; this is how screenshots get into one.
- **`record`** turns scenarios into videos for docs and websites. `--steps` names a module whose default export maps scenario names to steps:

  ```ts
  // steps.ts: scenario name → what to do once it is ready
  import type { Page } from '@playwright/test';

  export default {
    'search-no-results': async (page: Page) => {
      await page.getByRole('searchbox').click();
      await page.keyboard.type('Atlantis', { delay: 100 });
    },
    // { element, steps } crops this scenario's video to one component; it overrides --element.
    'cart-empty': {
      element: '.cart',
      steps: async (page: Page) => {
        await page.getByRole('link', { name: 'Browse products' }).hover();
      },
    },
  };
  ```

  Each scenario opens with the panel hidden and a drawn cursor that glides to each target before a click or typing lands (`--cursor-color <css>` or `--cursor <file.svg>` to change it), runs its steps, and holds the last frame for `--hold` ms (default 800). The video starts once the scenario is ready, so the page load isn't in it. `--format mp4` (default) is H.264, which plays in every browser and phone and is a fraction of a GIF's size; prefer it on websites. `--format gif` is for places that only take images, such as READMEs. `--element <selector>` crops to one component. For smaller files, `--fps` sets the frame rate (GIFs default to 12) and `--width 900` caps the width. The browser flags above apply too, except `--scale`: Playwright records video at viewport size, so use a larger `--viewport` for a sharper video. mp4, gif, `--element`, `--fps` and `--width` need [ffmpeg](https://ffmpeg.org/download.html) on `PATH`, or set `FFMPEG_PATH`. `--format webm` without those three needs no ffmpeg, but includes the page load. Next to each video, `record` writes `<name>.video.json` with its size, length, scenario description and clicks (ms into the video, pixels in it; `kind: "focus"` marks a field taking focus to be typed into), so an editor such as [Remotion](https://www.remotion.dev) can size a composition, caption it and zoom to each click. [`examples/remotion-promo`](examples/remotion-promo) cuts three recordings into a promo.
- **`suggest`** sends your source files and a summary of the catalog to a model; fixture bodies go as a count and a first item. The model lists **candidate** UI states, marks which existing scenarios cover them, and drafts scenarios for the gaps. The CLI rejects drafts that fail `--schema` (adapter state shapes included), the rules or an `extends` lookup, and says why. Valid drafts land in `<dir>/proposed/` for review, a folder `*.json` globs don't load. Prefer panel capture (record + Mark ready) for fixtures; treat suggest as ideation.
  - Default model: `claude-opus-5-5`, with server-side refusal fallback. It needs `ANTHROPIC_API_KEY` or `ant auth login`.
  - Other models: `--model` (or `STATE_SCENARIOS_MODEL`), with `ANTHROPIC_BASE_URL` pointing at an Anthropic-compatible proxy. `--env-file` loads those variables. The CLI drops Claude-only options for other models, and when a proxy rejects structured output it retries, asking for plain JSON.
- **`promote`** moves `<dir>/proposed/*.json` into `<dir>` after each draft resolves (and passes `--rules`). Refuses duplicate names. `--dry-run` prints moves only.

**Exit codes and error codes.** `0` ok, `1` a scenario failed, `2` bad arguments or scenarios, `3` something needed is missing or down (dev server, browser, ffmpeg, MSW worker). Errors print a stable code such as `[DEV_SERVER_DOWN]`, and `shoot --json` gives each scenario a `codes` list, so scripts and agents can branch without reading messages. `state-scenarios guide debugging` lists every code with its fix.

## Packages

| Package                                                   | What                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`state-scenarios`](packages/state-scenarios)             | Core: schema, runtime, panel, Playwright helper, store adapters (`/tanstack-query`, `/zustand`, `/redux`, `/xstate`) |
| [`state-scenarios-react`](packages/state-scenarios-react) | `useScenarioState` for component state (React, Preact)                                                               |
| [`state-scenarios-cli`](packages/state-scenarios-cli)     | `state-scenarios validate · list · shoot · record · suggest`                                                         |

Vue and Svelte hooks would be sibling packages (`state-scenarios-vue`, `state-scenarios-svelte`). The rest of the library has no framework dependency.

## Examples

- **`examples/who-speaks-what-preact/`** runs on Preact 11, XState 5, preact-iso and Tailwind 4. The same page state lives in a `useReducer` (`/`) and an XState machine (`/xstate`); each route connects with one `useScenarioState` call and a Zod schema, and `src/scenarios.ts` defines its page presets as scenarios. It mocks no network, so MSW never loads.
- **`examples/auth-flows/`** covers sign-in: password, a code sent by email, magic links, a locked account, skipping login with a session cookie, and an expired session. No email is sent: each scenario mocks the API calls around it. `code-screen` opens on the code step through `useScenarioState`. A Vite middleware stands in for the real backend (the code is `123456`), so `?scenario-record` has something real to record. **Sign in with Google** runs the real OAuth redirect flow against [emulate](https://emulate.dev)'s Google emulator, which the middleware starts. A redirect to another origin is a page load MSW can't intercept, so an emulator covers the flow itself. Scenarios still cover the screens around it, such as `google-cancelled`. `emulate` is a dev dependency of this example only.
- **`examples/next-app/`** runs the session in a Next.js App Router layout: client fetches, URL params and cookies.
- **`examples/demo-react/`** rebuilds the same app in React around an API. Its 13 scenario files cover network fixtures, sequences, cache seeding, strict mode and inheritance.
- **`examples/remotion-promo/`** records three demo-react scenarios with `record` and edits them into a promo video with [Remotion](https://www.remotion.dev): a title card, a zoom to each click from the video manifests, and a caption per scenario.

## Screenshots on every pull request

`actions/pr-screenshots` is a GitHub Action that shows each pull request's UI change in a comment. It runs `affected` to pick the states the PR touches, shoots them on the base and on the change, publishes what changed to a `scenario-shots` branch, and posts one comment with before, after and changed-pixel images. Pushing again updates the comment. It needs no model or API key.

```yaml
on: pull_request

permissions:
  contents: write # push the images to the scenario-shots branch
  pull-requests: write # comment on the PR

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - uses: jagreehal/state-scenarios/actions/pr-screenshots@main
        with:
          scenarios: src/scenarios
          dev-command: npm run dev
          base-url: http://localhost:5173
```

- It installs and starts the app twice, base then change, with `install-command` (default `npm ci` plus Chromium) and `dev-command`, and stops the dev server each time.
- When a changed file maps to no scenario (a stylesheet, a layout), it shoots every state (`all-when-unmatched: 'false'` turns that off). `src` limits it to the app's folders in a monorepo; `shoot-args` passes flags such as `--no-panel --viewport 1280x800` to both sides.
- It fails when a touched state fails on the change (`fail-on-error: 'false'` to only report). The job summary has the comment, and the run's `pr-screenshots` artifact has every image.
- Pull requests from forks get a read-only token, so they get the summary and the artifact, not a comment.
- It runs the pull request's code, as any `pull_request` workflow does. Don't run it on `pull_request_target`.

This repository runs it on the demo app: [`.github/workflows/pr-screenshots.yml`](.github/workflows/pr-screenshots.yml).

## Coding agents

Claude Code, Codex, Cursor and other coding agents use state-scenarios in three ways.

**Links.** Any browser tool opens a state directly with `?scenario=<name>&scenario-strict`, so an agent never has to click through the app to reach it. `list --json` prints every scenario with its link.

**Skills.** The CLI package ships four skills, and `init` installs them into `.agents/skills/` (read by Codex, Cursor and others) with links from `.claude/skills/` for Claude Code. Rerun `init` after upgrading to update them. `state-scenarios guide [topic]` prints the same text from the installed package, so the guidance always matches the version.

- **`state-scenarios`**: a short overview and rules, with topics loaded when needed: `setup`, `writing-scenarios`, `capture`, `auth`, `network`, `verify`, `media`, `mcp`, `debugging`.
- **`create-scenario-map`**: maps each feature to its states (loading, empty, error, signed out…), marks which have scenarios, captures the most important missing ones, and proves the map with `shoot`. It writes a project-local `scenarios-<app>` skill. Run it with `/create-scenario-map`.
- **`scenario-pr`**: writes a PR description that shows the change: `affected` picks the states the branch touches, `shoot --compare` takes them before and after, `publish` puts the images in the PR, and a short outline shows the code's shape. Run it with `/scenario-pr`.
- **`scenario-coverage-loop`**: sets up a scheduled agent that fills the map's missing states a few at a time, one PR per run: `coverage` measures the gap, a small script picks the next states, the agent captures them, and a PR check keeps every state rendering. Run it with `/scenario-coverage-loop`.

For agents that need a pointer, add a line to `AGENTS.md` or `CLAUDE.md`: `UI states use state-scenarios; read .agents/skills/state-scenarios/SKILL.md before adding or checking one.`

**MCP server.** `state-scenarios mcp <dir> --base-url <url>` gives an agent its own headless page on the running app. `init` registers it in `.mcp.json` and, when present, `.cursor/mcp.json`; for Codex, run `codex mcp add state-scenarios -- npx state-scenarios mcp src/scenarios --base-url http://localhost:5173`.

| Tool                         | Does                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `list_scenarios`, `validate` | The catalog with links; problems in it                                                                        |
| `open_scenario`              | Opens a scenario in strict mode, waits for `ready`, returns codes, unmocked requests, errors and a screenshot |
| `open_app`                   | Opens a path without a scenario; `record: true` records real responses                                        |
| `observe`, `screenshot`      | The page as an accessibility tree, or as a PNG                                                                |
| `click`, `fill`, `press`     | Act on the page with Playwright selectors                                                                     |
| `check_ready`                | Whether a selector matches and is visible now, plus selectors that would                                      |
| `save_scenario`              | Writes what the app shows as `<dir>/<name>.json`; with `extends`, only the differences                        |

So an agent can open the app, drive it into a state, check the `ready` selector, save the scenario, and reopen it to prove it replays offline, without the panel. Each tool runs through `startScenarios` in the page, so the app needs this version of `state-scenarios`.

## Development

```sh
pnpm install
pnpm --filter demo-react dev             # demo, panel in the bottom-right corner
pnpm --filter who-speaks-what-preact dev # Preact + XState example
pnpm build            # all packages (tsup + tsc declarations, via turbo)
pnpm lint             # oxlint (type-aware, anti-slop rules) + dprint check
pnpm lint:fix         # autofix, then format
pnpm typecheck
pnpm test             # unit: schema, inheritance, rules, JSON Schema ↔ Zod, adapters, runtime, suggest, docs examples
pnpm test:e2e         # Playwright: demo, the save-and-share workflow, the Preact app, visual baselines
pnpm test:e2e:update  # accept intended visual changes
pnpm schema           # regenerate examples/demo-react/scenario.schema.json (a test fails if it's stale)
pnpm quality          # build, lint, typecheck, test, test:e2e
pnpm changeset        # describe a change; `pnpm release` builds and publishes
```

Code blocks in this README and the skills that show `docs/examples/*.ts` are copies of those files, which `pnpm typecheck` compiles; a test fails when a copy drifts. Edit the file, then the copies.

Lint runs oxlint with type-aware rules and the vendored [anti-slop](tools/oxlint/anti-slop/UPSTREAM.md) plugin at `error`, with `--deny-warnings`. The rules push unknown input through a schema at its boundary and forbid unchecked type assertions, so the code above has no `as` casts outside `as const`. dprint formats TypeScript, JSON and Markdown.

## Known limits

- **Visual baselines are per-OS.** The repo holds macOS (`*-darwin.png`) and Linux (`*-linux.png`) baselines; the Linux ones come from the Playwright Docker image, matching CI.
- **Strict mode treats any path with a file extension as an asset** (MSW's `isCommonAssetRequest`), so `GET /api/data.json` passes through. List such endpoints in the scenario, or watch `unhandledRequests`.
- **Inline links carry the whole flattened scenario.** Large fixtures, or a captured 2,480-country page state, make long links. The hash has no server limit, but pasting one gets unwieldy; use **Download JSON** instead.
- **In-place switching can't undo state.** When the new scenario doesn't cover a key the previous one set, the page reloads.
