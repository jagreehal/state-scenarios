# state-scenarios-cli

```sh
npx state-scenarios validate scenarios --rules rules.ts
npx state-scenarios list scenarios --base-url http://localhost:5173 --json
npx state-scenarios shoot scenarios --base-url http://localhost:5173 --out shots
npx state-scenarios suggest scenarios --src src --schema scenario.schema.json
```

- `shoot` opens every scenario in Chromium, waits until it's ready, and saves a screenshot. It fails on unmocked requests, uncaught exceptions and `console.error` calls. It needs `@playwright/test`.
- `suggest` asks Claude, or another model behind `ANTHROPIC_BASE_URL` via `--model`, which UI states lack scenarios, and drafts them for review.
