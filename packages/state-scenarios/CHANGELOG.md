# state-scenarios

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
