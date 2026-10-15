# state-scenarios-cli

```sh
npx state-scenarios init src/scenarios           # scaffold, install agent skills, register the MCP server
npx state-scenarios doctor scenarios --base-url http://localhost:5173
npx state-scenarios guide [topic]
npx state-scenarios mcp scenarios --base-url http://localhost:5173
npx state-scenarios validate scenarios --rules rules.ts
npx state-scenarios list scenarios --base-url http://localhost:5173 --json
npx state-scenarios shoot scenarios --base-url http://localhost:5173 --out shots
npx state-scenarios affected scenarios --base main --src src
npx state-scenarios shoot scenarios --base-url http://localhost:5173 --only a,b --out shots/after --compare shots/before
npx state-scenarios coverage scenarios
npx state-scenarios publish shots/after/*.diff.png --folder pr-42
npx state-scenarios shoot scenarios --base-url http://localhost:5173 --no-panel --viewport 1440x900 --scale 2 --color-scheme dark --locale de-DE --timezone Europe/Berlin
npx state-scenarios record scenarios --base-url http://localhost:5173 --steps steps.ts --format mp4
npx state-scenarios suggest scenarios --src src --schema scenario.schema.json
```

- `shoot` opens every scenario in Chromium, waits until it's ready, and saves a screenshot. It fails on unmocked requests, uncaught exceptions and `console.error` calls, and writes `<out>/<name>.md` for each failure with the fix. It needs `@playwright/test`.
- `affected` lists the scenarios a branch can affect, and why. `shoot --compare <dir>` writes a before/after/changed image for each state that differs from an earlier run. `coverage` counts the scenario map's states by status. `publish` pushes files to a `scenario-shots` branch and prints Markdown image links for a PR.
- `doctor` checks the wiring one step at a time and prints each fix. `mcp` lets a coding agent open, drive and save scenarios. `guide` prints the shipped agent skill.
- Exit codes: `1` a scenario failed, `2` bad arguments or scenarios, `3` something needed is missing or down. Errors print a stable code, e.g. `[DEV_SERVER_DOWN]`.
- `record` opens each scenario named in `--steps`, runs its steps with a visible cursor that reaches each click or field before the action (`--cursor-color`, `--cursor <file.svg>`), and saves an MP4, GIF or WebM, optionally cropped to `--element` (or per scenario with `{ element, steps }`). `--fps`, `--width` and `--hold <ms>` tune size and the final frame. Each video gets a `<name>.video.json` manifest (size, length, description, clicks, focused fields) for editors such as Remotion. MP4, GIF, cropping, `--fps` and `--width` need ffmpeg.
- `suggest` asks Claude, or another model behind `ANTHROPIC_BASE_URL` via `--model`, which UI states lack scenarios, and drafts them for review.
