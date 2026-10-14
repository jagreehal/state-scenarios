---
"state-scenarios": minor
"state-scenarios-cli": minor
---

The recorded cursor is now a bright arrow that pulses and ripples on each click, and `record` lets it glide to each target before `locator.click()` lands, so viewers can see where the click is about to go. `showCursor(page, { color, svg })` and `record --cursor-color <css>` / `--cursor <file.svg>` customise it.
