import { checkReadySelector } from './ready.js';
import type { ScenarioStep } from './schema.js';

export interface StepOptions {
  /** How long each selector may take to show. Default 5000ms. */
  timeout?: number;
  /** Stop between steps once this returns false, e.g. after the session is destroyed. */
  current?: () => boolean;
}

/**
 * Take a scenario's steps in the page, the way a person would: events the app's handlers
 * see, including the pointer events component libraries open menus on.
 */
export async function runSteps(
  steps: ScenarioStep[],
  { timeout = 5000, current = () => true }: StepOptions = {},
) {
  // Each target is checked again after its wait: a switch or destroy during it cancels the step.
  const at = async (selector: string) => {
    const el = await find(selector, timeout, current);

    return current() ? el : undefined;
  };

  for (const step of steps) {
    if (!current()) return;

    if ('press' in step && !step.on) {
      key(document.activeElement ?? document.body, step.press);
      continue;
    }

    const el = await at(targetOf(step));

    if (!el) return;

    if ('wait' in step) continue;

    if ('click' in step) press(el);
    else if ('fill' in step || 'select' in step) fill(el, step.value);
    else if ('check' in step) {
      if (!(el instanceof HTMLInputElement && el.checked)) press(el);
    } else key(el, step.press);
  }
}

/** The selector a step acts on or waits for; a press without `on` has none and is handled first. */
function targetOf(step: ScenarioStep): string {
  if ('click' in step) return step.click;

  if ('fill' in step) return step.fill;

  if ('check' in step) return step.check;

  if ('select' in step) return step.select;

  return 'wait' in step ? step.wait : step.on ?? '';
}

/** The first visible match, polled until `timeout`; undefined once `current` turns false. */
async function find(selector: string, timeout: number, current: () => boolean): Promise<Element | undefined> {
  const until = performance.now() + timeout;

  // `unchecked` also covers a role the engine only knows once an element has it (role=dialog
  // before the dialog opens), so only selector forms it can't read fail straight away.
  const readable = !selector.includes('>>')
    && (/^(text|role|css)=/.test(selector) || !/^[a-z-]+=/i.test(selector));

  if (!readable) throw new Error(`step selector "${selector}": steps take text=, role= or CSS selectors`);

  for (;;) {
    if (!current()) return undefined;
    const found = checkReadySelector(selector);

    if (found.status === 'invalid') throw new Error(`step selector "${selector}": ${found.error}`);

    // Not just the first match: a hidden copy (a closed menu's) can come before the visible one.
    if (found.status === 'match' && found.firstVisible) return found.firstVisible;

    if (performance.now() > until) {
      throw new Error(`step selector "${selector}" didn't show within ${timeout}ms`);
    }

    await new Promise((done) => setTimeout(done, 50));
  }
}

function press(el: Element) {
  const at = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const pointer = { ...at, pointerType: 'mouse', isPrimary: true };

  el.dispatchEvent(new PointerEvent('pointerdown', pointer));
  el.dispatchEvent(new MouseEvent('mousedown', at));

  if (el instanceof HTMLElement) el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', pointer));
  el.dispatchEvent(new MouseEvent('mouseup', at));

  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', at));
}

/** Set a field's value through its prototype's setter, which React's change tracking watches. */
function fill(el: Element, value: string) {
  if (el instanceof HTMLElement) el.focus();

  if (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  ) {
    Reflect.set(Object.getPrototypeOf(el), 'value', value, el);
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    el.textContent = value;
  } else {
    throw new Error(`step target <${el.localName}> isn't a field`);
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function key(el: Element, name: string) {
  const init = { key: name, bubbles: true, cancelable: true, composed: true };

  const allowed = el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));

  // Browsers submit a field's form on Enter only for a real key press, so do it here.
  if (allowed && name === 'Enter' && el instanceof HTMLInputElement && el.form) el.form.requestSubmit();
}
