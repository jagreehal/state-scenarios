---
'state-scenarios': minor
---

Next.js support and network recording.

- `state-scenarios` and `state-scenarios/panel` load during server rendering, so a Next.js App Router layout can start the session from a client component. Scenario `url` params reach `useSearchParams`.
- `?scenario-record` (or `record: true`) sends requests to your real backend and records their JSON responses. "Save as scenario" writes them as network entries, with repeated calls as a `sequence`, so the saved scenario replays offline.
