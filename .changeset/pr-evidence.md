---
"state-scenarios-cli": minor
---

New commands for showing UI changes in pull requests and tracking scenario coverage:

- `affected` lists the scenarios a branch can affect, and why (changed scenario files and what extends them, scenario map Source columns, endpoints, routes).
- `shoot --compare <dir>` diffs each screenshot against an earlier run and writes before | after | changed images.
- `coverage` counts the scenario map's states by status and fails when the map names a scenario that doesn't exist.
- `publish` pushes files to a `scenario-shots` branch without touching the checkout and prints Markdown image links.

Two new skills use them: `scenario-pr` writes a PR description with before and after screenshots, and `scenario-coverage-loop` sets up a scheduled agent that fills missing states one PR at a time. The scenario map gains a Source column, and the `state-scenarios` skill now says to show real states rather than mock-ups.
