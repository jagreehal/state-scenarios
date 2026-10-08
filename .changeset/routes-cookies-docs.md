---
'state-scenarios': minor
'state-scenarios-cli': minor
---

Routes, cookies and docs screenshots.

- A scenario's `path` sets the route it opens at. Links, the panel, `shoot`, `list` and `openInlineScenario` go there, and "Save as scenario" records the current route.
- `state-scenarios/cookies` sets cookies before the app renders, so cookie-based sign-in works in scenarios. Adapters with `fromLinks: false` take state from catalog scenarios only; the cookies adapter sets it.
- `openScenario(page, name, { panel: false })` hides the dev panel for docs screenshots and videos.
- msw 2.4 and later work alongside msw 3.
