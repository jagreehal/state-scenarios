# state-scenarios

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
