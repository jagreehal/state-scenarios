---
"state-scenarios": minor
"state-scenarios-cli": minor
---

`showCursor(page, { glide, size, halo })`: `glide` makes clicks, checks and typing wait for the cursor to reach their target, `size` scales the pointer and `halo` sets the pulse's diameter (`false` hides it). `glideBeforeActions(page)` turns on the glide alone. `record` glides before typing too, and its `<name>.video.json` marks each field taking focus with `kind: "focus"`, so the Remotion example holds the camera on a field while the steps type into it.
