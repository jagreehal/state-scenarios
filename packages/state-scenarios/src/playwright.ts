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

/** Options for {@link showCursor}. */
export interface CursorOptions {
  /** Colour of the arrow, its pulse and the click ripple. Default `#ff2d55`. */
  color?: string;
  /** Your own cursor as SVG markup, drawn with its top-left corner at the mouse. Replaces the arrow. */
  svg?: string;
}

/**
 * Draw a mouse pointer that follows Playwright's mouse, since recorded videos don't show one.
 * It's a bright arrow with a pulsing halo that glides between points and sends out a ripple on
 * each click. Call before the page loads, e.g. before `openScenario`.
 */
export async function showCursor(page: Page, options: CursorOptions = {}) {
  await page.addInitScript(({ color = '#ff2d55', svg }) => {
    type Pointer = { type: 'move' | 'down' | 'up'; x: number; y: number; };

    // Only the top frame draws. Other frames pass their mouse events to their parent, which adds the
    // iframe's place, so a page with iframes shows one cursor.
    let show = (pointer: Pointer) => parent.postMessage({ stateScenariosCursor: pointer }, '*');

    const local = (type: Pointer['type']) => (e: MouseEvent) => show({ type, x: e.clientX, y: e.clientY });
    addEventListener('mousemove', local('move'), true);
    addEventListener('mousedown', local('down'), true);
    addEventListener('mouseup', local('up'), true);
    addEventListener('message', (e) => {
      const pointer: Pointer | undefined = e.data?.stateScenariosCursor;
      const frame = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);

      if (!pointer || !frame) return;

      // Same mapping as the CLI's pagePoint: the measured box over the layout size gives the
      // iframe's CSS scale, which applies to its border, padding and the point itself.
      const box = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const scaleX = box.width / frame.offsetWidth || 1;
      const scaleY = box.height / frame.offsetHeight || 1;

      show({
        ...pointer,
        x: box.left + (frame.clientLeft + parseFloat(style.paddingLeft) + pointer.x) * scaleX,
        y: box.top + (frame.clientTop + parseFloat(style.paddingTop) + pointer.y) * scaleY,
      });
    });

    if (window !== window.top) return;

    const style = document.createElement('style');
    style.textContent = `
      .ss-cursor, .ss-ripple {
        position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147483647;
      }
      .ss-cursor { transition: transform .35s ease-in-out; }
      .ss-cursor > * { display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); transition: scale .1s; transform-origin: 0 0; }
      .ss-cursor[data-down] > * { scale: .8; }
      .ss-cursor::before, .ss-ripple { border-radius: 50%; box-sizing: border-box; border: 3px solid ${color}; }
      .ss-cursor::before {
        content: ''; position: absolute; width: 28px; height: 28px; left: -14px; top: -14px; animation: ss-pulse 1.2s ease-out infinite;
      }
      .ss-ripple { width: 64px; height: 64px; margin: -32px 0 0 -32px; animation: ss-ripple .6s ease-out forwards; }
      @keyframes ss-pulse { from { scale: .4; opacity: .9; } to { scale: 1.3; opacity: 0; } }
      @keyframes ss-ripple { from { scale: .3; opacity: 1; } to { scale: 1.6; opacity: 0; } }`;

    const cursor = document.createElement('div');
    cursor.className = 'ss-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = svg
      ?? `<svg width="32" height="37" viewBox="0 0 26 30"><path d="M2 2v23l6-6 4.5 9 4-2-4.5-9H21z" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    // Start mid-screen so the first glide to a target shows in the video.
    cursor.style.transform = `translate(${innerWidth / 2}px,${innerHeight / 2}px)`;

    show = ({ type, x, y }) => {
      if (type === 'up') {
        delete cursor.dataset.down;

        return;
      }

      cursor.style.transform = `translate(${x}px,${y}px)`;

      if (type === 'move') return;

      cursor.dataset.down = '';
      const ripple = document.createElement('div');
      ripple.className = 'ss-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.addEventListener('animationend', () => ripple.remove());
      document.documentElement.append(ripple);
    };

    const attach = () => document.documentElement.append(style, cursor);

    if (document.documentElement) attach();
    else addEventListener('DOMContentLoaded', attach);
  }, options);
}
