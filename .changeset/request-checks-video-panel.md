---
'state-scenarios': minor
'state-scenarios-cli': minor
---

**Request checks.** Add `expect` to a network entry to check the query and JSON body the app sends. `shoot`, the MCP server and Playwright (`requestMismatches(page)`, `suspiciousRequests(page)`) report a request that differs, or one the app never sends, as `REQUEST_MISMATCH`, and a URL such as `/users//orders` or `?id=undefined` as `SUSPICIOUS_URL`. `{ "$repeat": n, "item": … }` in a response body generates long lists, and `state-scenarios from-har` turns a HAR file into a redacted scenario that replays on localhost.

**Smoother videos.** `record` captures with Chrome's built-in recorder at 60fps, and each video's length and size match its manifest. It needs Chromium 153+ (`@playwright/test` 1.63+) and ffmpeg.

**A simpler panel.** Three tabs: **Scenarios** to switch, **Edit** for the scenario JSON and live state, and **Save** with one primary action and a crosshair to pick the ready element. Icon buttons reset and close it. Open `?scenario=a,b` to combine scenarios.
