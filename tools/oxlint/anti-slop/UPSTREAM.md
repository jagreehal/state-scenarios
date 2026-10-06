# anti-slop provenance

- **Source:** the `install-anti-slop` skill bundle (`~/.claude/skills/install-anti-slop/assets/anti-slop`), copied by its `scripts/install.mjs` on 2026-10-06.
- **Upstream repository and commit:** unknown. The skill bundle isn't a Git checkout and records no source revision.
- **Snapshot digest:** `69fa217ad6262822167aeaa4b4cf9d10bddbba0bd9fcb7f83e1807f3707bdca3` (SHA-256 over the sorted per-file SHA-256 list of the bundle). It identifies the copied bytes but can't reconstruct them.
- **Installed paths:** `tools/oxlint/anti-slop/index.ts` (generic plugin, registered as `anti-slop` in `.oxlintrc.json`), with `rules/`, `shared/` and `vendor/eslint-stylistic/` (its own LICENSE and UPSTREAM.md). `effect/` is copied but not registered: this repo doesn't depend on Effect.
- **Plugin API:** `oxlint` and `@oxlint/plugins` pinned to 1.86.0. 1.87.0 was current, but the workspace's one-day `minimumReleaseAge` rejected it on install day.
- **Local deviations:** none. All generic rules run at `error`.
