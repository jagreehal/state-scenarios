# state-scenarios

## 0.7.0

### Minor Changes

- f2541b9: Open any state of an app you can't change, and reach states that need clicks or a set date.
  
  **Apps you can't change**
  
  - `stateScenarios({ dir, inject })` from `state-scenarios/vite` starts scenarios, MSW and the panel before the app's entry runs. Add it from a Vite config that extends the app's. `handlers` takes modules or globs of the app's MSW handlers, and every handler they export can be named in a scenario's `"handlers"`. `inject` also takes `defaultScenario`, `strict`, `allowLinks`, `ignore`, `allow`, `panel: false` and `build: true`. It connects the cookies and storage adapters, keeps `DOMContentLoaded` and `load` for the app's entry, and sends code, stylesheets, fonts and frames straight to the network.
  - `routeScenario(page, { url, scenario, scenarios, handlers, named })` from `state-scenarios/playwright` answers an API from the test. `use()` overrides come first, then the scenario's `network`, named handlers and your handlers. It lists requests nothing answered in `unhandled`, and supports `HttpResponse.error()` and `passthrough()`. It sets the scenario's `now`, cookies, `localStorage` and `sessionStorage` before the app's scripts run.
  
  **New scenario fields and adapters**
  
  - `steps`: `click`, `fill`, `check`, `select`, `press` and `wait`, taken once `ready` shows, for an open menu or a filled form. `openScenario`, `shoot` and agents wait for them, and `inspect` reports `STEPS_FAILED` when they throw or don't finish. Inline links skip them.
  - `now`: the time the app starts at, e.g. `"2031-03-31T09:00:00Z"`. The clock runs on from there.
  - An empty value in `state.cookies` removes that cookie, for signed-out states.
  - `storageAdapter()` from `state-scenarios/storage` sets `state.localStorage`, or `state.sessionStorage` with `{ area: 'session' }`.
  - `namedHandlers(...modules)` names every MSW handler a module exports.
  
  **Safer links and recordings**
  
  - Inline links open on localhost; `startScenarios({ allowLinks: true })` opens them elsewhere.
  - Fixtures answer API requests only, never page loads or code, and carry `x-content-type-options: nosniff`.
  - `navigate()` stays on the app's origin, the panel saves to a loopback server, and `openScenario` keeps `path` inside the app.
  - Redaction covers Stripe, GitHub, AWS and Slack keys under any key name, and capture logs each redacted field.
  - `?scenario-strict` blocks the real network with no scenario selected, and `?scenario-record` carries across switches.
  
  **CLI**
  
  - `record` notes `cover`, the share of the video an element covers, on each point in `<name>.video.json`, and reads a popup's field after it settles on screen. The Remotion example zooms once per gesture and skips large elements.
  - `map` marks a row stale when any scenario it names is gone, and follows `extends` from every match.
  - `shoot` counts console errors from the app's own frames, leaving out a payment or captcha iframe's errors and CSP warnings. `--ignore-console <regex>` drops others.
  - `publish` checks file names, `mcp` answers every call before exiting, and `doctor` checks the save route returns JSON.

## 0.6.0

### Minor Changes

- a725f16: `showCursor(page, { glide, size, halo })`: `glide` makes clicks, checks and typing wait for the cursor to reach their target, `size` scales the pointer and `halo` sets the pulse's diameter (`false` hides it). `glideBeforeActions(page)` turns on the glide alone. `record` glides before typing too, and its `<name>.video.json` marks each field taking focus with `kind: "focus"`, so the Remotion example holds the camera on a field while the steps type into it.

## 0.5.0

### Minor Changes

- a8fc573: Show UI changes in pull requests and track scenario coverage.
  
  - `affected` lists the scenarios a branch touches, with the reason for each.
  - `shoot --compare <dir>` writes a before, after and changed-pixels image for each state that differs from an earlier run.
  - `coverage` counts the scenario map's states as covered, missing or can't mock.
  - `publish` pushes images to a `scenario-shots` branch and prints Markdown links for a PR.
  - The `actions/pr-screenshots` GitHub Action runs these on each pull request and posts the images as one comment.
  - New `scenario-pr` and `scenario-coverage-loop` skills. Scenario maps gain a Source column.
  - `record` draws a bright arrow cursor that pulses, ripples on each click and glides to each target before clicking. Set it with `--cursor-color` or `--cursor <file.svg>`, or `showCursor(page, { color, svg })`.

## 0.4.0

### Minor Changes

- aafbab2: Screenshots, videos and coding agent support.
  
  - **`shoot`:** `--no-panel`, `--viewport`, `--scale`, `--color-scheme`, `--element`, `--locale` and `--timezone`. A scenario's `viewport` field sets its own size.
  - **`record`:** runs scenario steps and saves MP4, GIF or WebM with a drawn cursor, optionally cropped to `--element`. `showCursor(page)` from `state-scenarios/playwright` draws the cursor in your own videos.
  - **Real apps:** `handlers` reuses your named MSW handlers in scenarios, `ignore` keeps analytics and other third-party requests out of strict mode, and `unsignedJwt(claims)` builds tokens for signed-in scenarios.
  - **Saved scenarios leave secrets out:** tokens and secret fields in responses and adapter state become `"[redacted]"`, signed JWTs come back unsigned with the same claims, and secret URL params are dropped.
  - **Coding agents:** `init` installs the `state-scenarios` and `create-scenario-map` skills and registers the `state-scenarios mcp` server. `guide` prints the skills and `doctor` checks the setup and prints a fix for each problem.
  - **Failures you can act on:** `shoot` writes a page per failed scenario with its link, selector suggestions and `network` entries for unmocked requests. Errors carry codes such as `[DEV_SERVER_DOWN]`, and the exit code says what failed: `1` a scenario, `2` arguments or scenario files, `3` missing setup such as the dev server, browser, MSW worker or ffmpeg.

## 0.3.0

### Minor Changes

- cf5c45d: Capture your first scenario from the panel in a few clicks.
  
  - **Mark ready:** click the UI to set `ready`. The panel outlines the element and shows the selector it will save. The Ready field reports whether the selector matches on the page, using Playwright's rules.
  - **Save to project:** the `state-scenarios/vite` plugin and `createSaveRoute` from `state-scenarios/next` write the scenario into your scenarios folder. They run in dev only, accept saves from the app on this machine, and ask before replacing a file.
  - **Extends:** Download JSON and Save to project write only the overrides against a base scenario. Copy link keeps a flat snapshot.
  - **CLI:** `init` creates `default.json`, the schema and a wiring snippet. `promote` moves reviewed drafts from `proposed/` into the catalog.
  - **API:** `captureScenario(session, { name, description?, ready?, base?, schemaPath? })` returns `{ flat, forCatalog }`. `diffScenario`, `selectorForElement`, `suggestReadySelectors` and `checkReadySelector` are exported from `state-scenarios`.
- af8c5bf: Next.js support and network recording.
  
  - `state-scenarios` and `state-scenarios/panel` load during server rendering, so a Next.js App Router layout can start the session from a client component. Scenario `url` params reach `useSearchParams`.
  - `?scenario-record` (or `record: true`) sends requests to your real backend and records their JSON responses. "Save as scenario" writes them as network entries, with repeated calls as a `sequence`, so the saved scenario replays offline.

## 0.2.0

### Minor Changes

- 1339b13: Routes, cookies and docs screenshots.
  
  - A scenario's `path` sets the route it opens at. Links, the panel, `shoot`, `list` and `openInlineScenario` go there, and "Save as scenario" records the current route.
  - `state-scenarios/cookies` sets cookies before the app renders, so cookie-based sign-in works in scenarios. Adapters with `fromLinks: false` take state from catalog scenarios only; the cookies adapter sets it.
  - `openScenario(page, name, { panel: false })` hides the dev panel for docs screenshots and videos.
  - msw 2.4 and later work alongside msw 3.

## 0.1.0

### Minor Changes

- c7a5c1b: Open any app state from a URL. Scenarios are JSON files that set API responses, URL params and app state; a dev panel switches, edits and saves them as shareable links. Includes Playwright helpers, adapters for TanStack Query, Zustand, Redux and XState, `useScenarioState` for component state, and the `state-scenarios` CLI (validate, list, shoot, suggest).
