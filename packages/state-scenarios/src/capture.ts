import { diffScenario } from './catalog.js';
import { PARAM, RECORD_PARAM, STRICT_PARAM } from './link.js';
import type { ScenarioSession } from './runtime.js';
import { parseScenario, type Scenario, type ScenarioInput } from './schema.js';

const SCENARIO_PARAMS = new Set([PARAM, STRICT_PARAM, RECORD_PARAM]);

export interface CaptureOptions {
  name: string;
  description?: string;
  /** Playwright selector that marks this UI state ready. */
  ready?: string;
  /**
   * Catalog scenario to `extends`. Diff uses its resolved (flattened) form.
   * Omit for a full self-contained snapshot.
   */
  base?: Scenario;
  /** Relative `$schema` path stamped on the catalog file only, e.g. `../scenario.schema.json`. */
  schemaPath?: string;
}

export interface CapturedScenario {
  /** Flattened snapshot for inline share links. */
  flat: Scenario;
  /** File to commit: diffs against `base` when set, otherwise the flat snapshot as input. */
  forCatalog: ScenarioInput;
}

/**
 * Snapshot what the app shows now: current route and URL params, the active network
 * fixtures (plus recorded responses), and every connected adapter's live state.
 */
export function captureScenario(session: ScenarioSession, options: CaptureOptions): CapturedScenario {
  const url: Record<string, string> = {};
  new URLSearchParams(location.search).forEach((v, k) => {
    if (!SCENARIO_PARAMS.has(k)) url[k] = v;
  });

  const state = Object.fromEntries(
    session.keys().flatMap((key) => {
      const value = session.read(key);

      return value === undefined ? [] : [[key, value] as const];
    }),
  );

  // Recorded responses go after the scenario's own: they answered requests it didn't mock.
  const network = [...(session.resolved?.network ?? []), ...session.recorded()];

  const draft = parseScenario({
    name: options.name,
    description: options.description || undefined,
    path: location.pathname,
    url,
    network: network.length ? network : undefined,
    state,
    ready: options.ready || undefined,
  });

  const flat = session.catalog.resolve(draft);
  const flatBase = options.base ? session.catalog.resolve(options.base) : undefined;
  const forCatalog = diffScenario(flat, flatBase);

  if (options.schemaPath) forCatalog.$schema = options.schemaPath;

  return { flat, forCatalog };
}
