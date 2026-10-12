---
'state-scenarios': minor
'state-scenarios-cli': minor
---

Screenshots, videos and coding agent support.

- **`shoot`:** `--no-panel`, `--viewport`, `--scale`, `--color-scheme`, `--element`, `--locale` and `--timezone`. A scenario's `viewport` field sets its own size.
- **`record`:** runs scenario steps and saves MP4, GIF or WebM with a drawn cursor, optionally cropped to `--element`. `showCursor(page)` from `state-scenarios/playwright` draws the cursor in your own videos.
- **Real apps:** `handlers` reuses your named MSW handlers in scenarios, `ignore` keeps analytics and other third-party requests out of strict mode, and `unsignedJwt(claims)` builds tokens for signed-in scenarios.
- **Saved scenarios leave secrets out:** tokens and secret fields in responses and adapter state become `"[redacted]"`, signed JWTs come back unsigned with the same claims, and secret URL params are dropped.
- **Coding agents:** `init` installs the `state-scenarios` and `create-scenario-map` skills and registers the `state-scenarios mcp` server. `guide` prints the skills and `doctor` checks the setup and prints a fix for each problem.
- **Failures you can act on:** `shoot` writes a page per failed scenario with its link, selector suggestions and `network` entries for unmocked requests. Errors carry codes such as `[DEV_SERVER_DOWN]`, and the exit code says what failed: `1` a scenario, `2` arguments or scenario files, `3` missing setup such as the dev server, browser, MSW worker or ffmpeg.
