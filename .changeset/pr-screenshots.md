---
"state-scenarios": minor
"state-scenarios-cli": minor
---

Show UI changes in pull requests and track scenario coverage.

- `affected` lists the scenarios a branch touches, with the reason for each.
- `shoot --compare <dir>` writes a before, after and changed-pixels image for each state that differs from an earlier run.
- `coverage` counts the scenario map's states as covered, missing or can't mock.
- `publish` pushes images to a `scenario-shots` branch and prints Markdown links for a PR.
- The `actions/pr-screenshots` GitHub Action runs these on each pull request and posts the images as one comment.
- New `scenario-pr` and `scenario-coverage-loop` skills. Scenario maps gain a Source column.
- `record` draws a bright arrow cursor that pulses, ripples on each click and glides to each target before clicking. Set it with `--cursor-color` or `--cursor <file.svg>`, or `showCursor(page, { color, svg })`.
