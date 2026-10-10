import type { Scenario } from './schema.js';

declare global {
  /** Requests the active scenario didn't cover, for tests and agents (see `unhandledRequests`). */
  var stateScenariosUnhandled: string[] | undefined;
}

export const PARAM = 'scenario';

/** Fail unmatched requests instead of letting them reach the network. */
export const STRICT_PARAM = 'scenario-strict';

/** Record real responses so they can be saved as a scenario. */
export const RECORD_PARAM = 'scenario-record';

/** Dev-server route the `state-scenarios/vite` plugin serves for the panel's "Save to project". */
export const SAVE_ENDPOINT = '/__state-scenarios/save';

/** Inline scenario JSON, kept in the URL hash so it never reaches a server. */
export const DATA_KEY = 'scenario-data';

/**
 * A shareable URL that opens the app in a resolved scenario.
 * `inline` embeds the flattened scenario, so the link works without the catalog.
 */
export function scenarioHref(
  resolved: Scenario,
  { base = location.href, inline = false, strict = false } = {},
): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';

  if (resolved.path) url.pathname = resolved.path;

  for (const [k, v] of Object.entries(resolved.url ?? {})) {
    if (v !== null) url.searchParams.set(k, v);
  }

  if (inline) {
    const { $schema: _schema, extends: _extends, ...snapshot } = resolved;
    url.hash = new URLSearchParams({ [DATA_KEY]: JSON.stringify(snapshot) }).toString();
  } else {
    url.searchParams.set(PARAM, resolved.name);
  }

  if (strict) url.searchParams.set(STRICT_PARAM, '');

  return url.toString();
}

/** Inline scenario JSON from a URL hash, if present. */
export const readInline = (hash: string) => new URLSearchParams(hash.slice(1)).get(DATA_KEY);
