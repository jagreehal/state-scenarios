# Writing scenarios

| Field                 | Meaning                                                                                                                                   | Through `extends`                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `name`                | kebab-case, unique                                                                                                                        | –                                                                        |
| `extends`             | Scenario name(s) to build on; later parents win                                                                                           | –                                                                        |
| `path`                | Route it opens at, e.g. `/orders/42`                                                                                                      | inherited                                                                |
| `url`                 | Query params the app starts with                                                                                                          | merged; `null` removes                                                   |
| `network[]`           | `method`, `path` (MSW syntax: `/api/users/:id`, absolute URLs, `*`), optional `query`, then one of `response`, `sequence`, `remove: true` | a child entry replaces the parent's with the same method, path and query |
| `handlers`            | Names of MSW handlers passed to `startScenarios({ handlers })`                                                                            | combined                                                                 |
| `state`               | Per-adapter state, keyed by adapter key                                                                                                   | deep-merged; `null` removes                                              |
| `ready`               | Playwright selector visible once this state shows                                                                                         | not inherited                                                            |
| `steps`               | Clicks and typing once `ready` shows, for an open dialog or a filled form                                                                 | not inherited                                                            |
| `now`                 | ISO time with a zone, e.g. `"2031-03-31T09:00:00Z"`; the app's clock starts there and runs on                                             | inherited                                                                |
| `viewport`            | `{ "width": 390, "height": 844 }` for `shoot` and `record`                                                                                | inherited                                                                |
| `description`, `tags` | For people and the panel                                                                                                                  | not inherited                                                            |

Responses: `body` is sent as JSON, `text` as text (an HTML error page). `status` defaults to 200.
`headers` sets headers. `delay` is milliseconds, or `"infinite"` to hold the request open for a
loading state. `sequence` answers successive calls in order and repeats the last one, e.g. fail
then succeed on retry:

```json
{
  "name": "flaky-then-recovers",
  "extends": "default",
  "network": [{
    "path": "/api/orders",
    "sequence": [{ "status": 503, "body": { "error": "busy" } }, { "body": [{ "id": 1 }] }]
  }],
  "ready": "text=Order #1"
}
```

Loading state: `"response": { "delay": "infinite" }` and `"ready": "text=Loading orders…"`.

## Steps

Use `steps` for UI state no response produces. Each one waits for its selector, then acts the way a
person would, pointer events included:

```json
{
  "name": "order-actions-open",
  "extends": "orders",
  "ready": "text=Order #1",
  "steps": [{ "click": "role=button[name=\"Actions\"]" }, { "wait": "role=menu" }]
}
```

Step types: `click`, `fill` + `value`, `check`, `select` + `value`, `press` (optional `on`), `wait`.
Selectors take `text=`, `role=` or CSS. `<html data-scenario-steps>` reads `running`, `done` or
`failed`; `openScenario` waits for `done`. Steps never run from an inline link.

## Ready selectors

`text=No orders yet`, `role=heading[name="Orders"]`, `[data-testid=empty-orders]`, or CSS. Pick
something that is visible only in this state: a count like "0" or a heading every state shares is
too generic. Check it against the running app (panel, or MCP `check_ready`) before saving.

## Combining

`?scenario=signed-in,server-error` combines scenarios like `extends`, later names winning.

## Rules and validation

`defineScenarioRules` checks business rules on every resolved scenario. Export `rules` from a module
and pass it to `startScenarios({ rules })` and `--rules` on the CLI.

```bash
npx state-scenarios validate src/scenarios --rules src/scenario-rules.ts
```

Schema shape, `extends` lookups and rules are checked. Whether production can actually reach a
state is your call: a valid scenario can describe a response the backend never sends.
