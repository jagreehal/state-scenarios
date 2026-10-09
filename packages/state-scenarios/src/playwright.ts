import type { Page } from '@playwright/test';
import { DATA_KEY, PARAM, STRICT_PARAM } from './link.js';
import type { ScenarioInput } from './schema.js';

export interface OpenOptions {
  /** App path to open. Default "/". */
  path?: string;
  /** Fail unmocked requests instead of letting them reach a real backend. Default true. */
  strict?: boolean;
  /** Show the dev panel. False hides it, for screenshots that go into product docs. Default true. */
  panel?: boolean;
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
  await open(page, scenario.name, new URLSearchParams(), hash, { path: scenario.path, ...options });
}

async function open(
  page: Page,
  name: string,
  search: URLSearchParams,
  hash: string,
  { path = '/', strict = true, panel = true }: OpenOptions,
) {
  if (strict) search.set(STRICT_PARAM, '');
  await setPanel(page, panel);
  // Leave the page first: a hash-only change would not reload the app.
  await page.goto('about:blank');
  await page.goto(`${path}?${search}${hash}`);
  const html = page.locator(`html[data-scenario="${name}"]`);
  await html.waitFor({ state: 'attached' });
  const ready = await html.getAttribute('data-scenario-ready');

  if (ready) await page.locator(ready).first().waitFor();
}

declare global {
  /** Exposed by `openScenario({ panel: false })`: whether this page should hide the panel. */
  var stateScenariosPanelHidden: (() => Promise<boolean>) | undefined;
}

// Per page: whether the panel is hidden. The init script asks on every load, so a later
// open can show the panel again on any Playwright version.
const panelHidden = new WeakMap<Page, { hidden: boolean; }>();

async function setPanel(page: Page, show: boolean) {
  const state = panelHidden.get(page);

  if (state) {
    state.hidden = !show;

    return;
  }

  if (show) return;
  const created = { hidden: true };
  panelHidden.set(page, created);
  await page.exposeFunction('stateScenariosPanelHidden', () => created.hidden);
  // Hide before the app's scripts run, so the panel never shows, not even in a video;
  // then show it again if this page no longer wants it hidden.
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'scenario-panel { display: none !important; }';
    // Init scripts can run before <html> exists: attach as soon as it does.
    const attach = () => document.documentElement.append(style);

    if (document.documentElement) attach();
    else {
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        attach();
      }).observe(document, { childList: true });
    }

    void globalThis.stateScenariosPanelHidden?.().then((hidden) => {
      if (!hidden) style.remove();
    });
  });
}

/** Requests the active scenario didn't cover, e.g. to assert none in strict runs. */
export const unhandledRequests = (page: Page): Promise<string[]> =>
  page.evaluate(() => globalThis.stateScenariosUnhandled ?? []);
