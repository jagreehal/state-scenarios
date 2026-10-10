---
'state-scenarios': minor
'state-scenarios-cli': minor
---

Capture your first scenario from the panel in a few clicks.

- **Mark ready:** click the UI to set `ready`. The panel outlines the element and shows the selector it will save. The Ready field reports whether the selector matches on the page, using Playwright's rules.
- **Save to project:** the `state-scenarios/vite` plugin and `createSaveRoute` from `state-scenarios/next` write the scenario into your scenarios folder. They run in dev only, accept saves from the app on this machine, and ask before replacing a file.
- **Extends:** Download JSON and Save to project write only the overrides against a base scenario. Copy link keeps a flat snapshot.
- **CLI:** `init` creates `default.json`, the schema and a wiring snippet. `promote` moves reviewed drafts from `proposed/` into the catalog.
- **API:** `captureScenario(session, { name, description?, ready?, base?, schemaPath? })` returns `{ flat, forCatalog }`. `diffScenario`, `selectorForElement`, `suggestReadySelectors` and `checkReadySelector` are exported from `state-scenarios`.
