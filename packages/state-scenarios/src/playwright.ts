import type { Page } from '@playwright/test';
import { DATA_KEY, PARAM, STRICT_PARAM } from './link.js';
import type { ScenarioInput } from './schema.js';

export interface OpenOptions {
  /** App path to open. Default "/". */
  path?: string;
  /** Fail unmocked requests instead of letting them reach a real backend. Default true. */
  strict?: boolean;
}

/**
 * Open the app in a catalog scenario and wait until the UI shows it: the scenario is
 * active and its `ready` selector, if any, is visible.
 */
export async function openScenario(page: Page, name: string, options: OpenOptions = {}) {
  await open(page, name, new URLSearchParams({ [PARAM]: name }), '', options);
}

/** Like `openScenario`, for a scenario defined in the test rather than the catalog. */
export async function openInlineScenario(page: Page, scenario: ScenarioInput, options: OpenOptions = {}) {
  const hash = `#${new URLSearchParams({ [DATA_KEY]: JSON.stringify(scenario) })}`;
  await open(page, scenario.name, new URLSearchParams(), hash, options);
}

async function open(
  page: Page,
  name: string,
  search: URLSearchParams,
  hash: string,
  { path = '/', strict = true }: OpenOptions,
) {
  if (strict) search.set(STRICT_PARAM, '');
  // Leave the page first: a hash-only change would not reload the app.
  await page.goto('about:blank');
  await page.goto(`${path}?${search}${hash}`);
  const html = page.locator(`html[data-scenario="${name}"]`);
  await html.waitFor({ state: 'attached' });
  const ready = await html.getAttribute('data-scenario-ready');

  if (ready) await page.locator(ready).first().waitFor();
}

/** Requests the active scenario didn't cover, e.g. to assert none in strict runs. */
export const unhandledRequests = (page: Page): Promise<string[]> =>
  page.evaluate(() => globalThis.stateScenariosUnhandled ?? []);
