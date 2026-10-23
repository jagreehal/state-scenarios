---
"state-scenarios": minor
"state-scenarios-cli": minor
---

Open any state of an app you can't change, and reach states that need clicks or a set date.

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
