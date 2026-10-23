// @vitest-environment happy-dom
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageAdapter } from '../packages/state-scenarios/src/adapters/storage.ts';
import { createCatalog } from '../packages/state-scenarios/src/catalog.ts';
import { installClock } from '../packages/state-scenarios/src/clock.ts';
import { namedHandlers } from '../packages/state-scenarios/src/network.ts';
import { startScenarios } from '../packages/state-scenarios/src/runtime.ts';
import { parseScenario, ScenarioSchema } from '../packages/state-scenarios/src/schema.ts';
import { runSteps } from '../packages/state-scenarios/src/steps.ts';

// Scenario fields that work without the app's help: a clock, steps, storage and named handlers.

const at = (href: string) => {
  vi.stubGlobal('location', new URL(href));
  vi.stubGlobal('history', {
    state: null,
    replaceState: (_state: null, _title: string, url: URL) => vi.stubGlobal('location', new URL(url)),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  sessionStorage.clear();
  localStorage.clear();
});

describe('installClock', () => {
  it('starts the clock at the given time and lets it run, leaving explicit dates alone', () => {
    const restore = installClock('2031-03-31T09:00:00Z');

    try {
      expect(Math.abs(Date.now() - Date.parse('2031-03-31T09:00:00Z'))).toBeLessThan(1000);
      expect(new Date().toISOString().slice(0, 16)).toBe('2031-03-31T09:00');
      expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
      expect(new Date(2020, 0, 2).getFullYear()).toBe(2020);
      expect(new Date()).toBeInstanceOf(Date);
      expect(Date.UTC(2020, 0, 1)).toBe(1577836800000);
      expect(Date()).toContain('2031');
    } finally {
      restore();
    }

    expect(new Date().getFullYear()).toBeLessThan(2031);
  });
});

describe('runSteps', () => {
  it('clicks with pointer events, fills, checks, selects, presses and waits, like a person', async () => {
    document.body.innerHTML = `
      <button>Open</button>
      <input aria-label="Name" />
      <input type="checkbox" id="agree" />
      <select id="tier"><option value="a">A</option><option value="b">B</option></select>`;
    const seen: string[] = [];
    const button = document.querySelector('button')!;
    button.addEventListener('pointerdown', () => seen.push('pointerdown'));
    button.addEventListener('click', () => {
      seen.push('click');
      setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<p>Dialog open</p>'), 30);
    });
    document.querySelector('input')!.addEventListener(
      'input',
      () => seen.push(`input ${document.querySelector('input')!.value}`),
    );
    document.addEventListener('keydown', (e) => seen.push(`key ${e.key}`));

    await runSteps([
      { click: 'role=button[name="Open"]' },
      { wait: 'text="Dialog open"' },
      { fill: 'input[aria-label=Name]', value: 'Acme' },
      { check: '#agree' },
      { select: '#tier', value: 'b' },
      { press: 'Escape', on: '#tier' },
    ]);

    expect(seen).toEqual(['pointerdown', 'click', 'input Acme', 'key Escape']);
    expect(document.querySelector<HTMLInputElement>('#agree')!.checked).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('#tier')!.value).toBe('b');
  });

  it('submits the form on Enter in a field, as a real key press does, unless the app cancels it', async () => {
    document.body.innerHTML = '<form><input name="q" /></form>';
    const submitted: string[] = [];
    document.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted.push(document.querySelector('input')!.value);
    });

    await runSteps([{ fill: 'input[name=q]', value: 'shoes' }, { press: 'Enter' }]);
    document.querySelector('input')!.addEventListener('keydown', (e) => e.preventDefault());
    await runSteps([{ press: 'Enter', on: 'input[name=q]' }]);

    expect(submitted).toEqual(['shoes']);
  });

  it('acts on the first visible match, not a hidden one before it', async () => {
    document.body.innerHTML = '<button hidden>Save</button><button id="shown">Save</button>';
    const clicked: string[] = [];
    document.body.addEventListener(
      'click',
      (e) => clicked.push(e.target instanceof Element ? e.target.id : ''),
    );

    await runSteps([{ click: 'text="Save"' }], { timeout: 200 });

    expect(clicked).toEqual(['shown']);
  });

  it('drops a step cancelled while it waits, so it never touches the next UI', async () => {
    let live = true;
    const clicked: string[] = [];
    const run = runSteps([{ click: 'text="Later"' }], { current: () => live });

    live = false; // the scenario switched while the step waited
    document.body.innerHTML = '<button>Later</button>';
    document.querySelector('button')!.onclick = () => clicked.push('later');

    await run;
    expect(clicked).toEqual([]);
  });

  it('waits for a role no element has yet, such as a dialog that opens later', async () => {
    setTimeout(
      () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog">New order</div>'),
      50,
    );

    await expect(runSteps([{ wait: 'role=dialog' }])).resolves.toBeUndefined();
  });

  it("names the step whose selector never shows, or that it can't read", async () => {
    await expect(runSteps([{ click: 'text="Nowhere"' }], { timeout: 100 })).rejects.toThrow(
      /"text="Nowhere"" didn't show/,
    );
    await expect(runSteps([{ click: 'xpath=//a' }])).rejects.toThrow(/text=, role= or CSS/);
  });
});

describe('steps and now in a session', () => {
  const catalog = [
    { name: 'base', now: '2031-03-31T09:00:00Z' },
    { name: 'dialog', extends: 'base', ready: 'text="List"', steps: [{ click: 'text="Add"' }] },
  ];

  const app = () => {
    document.body.innerHTML = '<p>List</p><button>Add</button>';
    document.querySelector('button')!.onclick = () =>
      document.body.insertAdjacentHTML('beforeend', '<p>Added</p>');
  };

  it('installs the clock before the app renders and takes the steps once it has, then puts Date back', async () => {
    at('http://localhost/?scenario=dialog');
    const session = await startScenarios({ scenarios: catalog });
    expect(new Date().getFullYear()).toBe(2031);
    expect(document.documentElement.dataset.scenarioSteps).toBe('running');

    app();
    await vi.waitFor(() => expect(document.documentElement.dataset.scenarioSteps).toBe('done'));
    expect(document.body.textContent).toContain('Added');

    session.destroy();
    expect(new Date().getFullYear()).toBeLessThan(2031);
    expect(document.documentElement.dataset.scenarioSteps).toBeUndefined();
  });

  it('never takes steps from an inline link, which anyone can write', async () => {
    const data = JSON.stringify(createCatalog(catalog).resolve(parseScenario(catalog[1])));
    at(`http://localhost/#${new URLSearchParams({ 'scenario-data': data })}`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = await startScenarios({ scenarios: [] });
    app();

    expect(session.active?.name).toBe('dialog');
    expect(document.documentElement.dataset.scenarioSteps).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("a link can't run steps"));
    session.destroy();
  });

  it('reloads to change the clock: it is set before the app starts', async () => {
    at('http://localhost/?scenario=base');

    const session = await startScenarios({
      scenarios: [...catalog, { name: 'later', now: '2032-01-01T00:00:00Z' }],
      refresh: () => {},
    });

    await session.open('later');
    expect(session.active?.name).toBe('base');
    expect(location.search).toBe('?scenario=later');
    session.destroy();
  });
});

describe('scenario fields', () => {
  it('inherit now but not steps, and reject a time without a zone or an unknown step', () => {
    const resolved = createCatalog([
      { name: 'base', now: '2026-03-31T09:00:00+01:00', steps: [{ click: '#a' }] },
      { name: 'child', extends: 'base' },
    ]).resolve(parseScenario({ name: 'child', extends: 'base' }));

    expect(resolved.now).toBe('2026-03-31T09:00:00+01:00');
    expect(resolved.steps).toBeUndefined();
    expect(() => parseScenario({ name: 'x', now: '2026-03-31' })).toThrow();
    expect(ScenarioSchema.safeParse({ name: 'x', steps: [{ hover: '#a' }] }).success).toBe(false);
  });
});

describe('storageAdapter', () => {
  it('stores strings as written and anything else as JSON, and reads JSON back', () => {
    const adapter = storageAdapter();
    void adapter.apply({ theme: 'dark', auth: { token: 'e2e' }, count: 3 });

    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('auth')).toBe('{"token":"e2e"}');
    expect(localStorage.getItem('count')).toBe('3');
    expect(adapter.read?.()).toEqual({ theme: 'dark', auth: { token: 'e2e' }, count: '3' });
    expect(adapter).toMatchObject({ key: 'localStorage', inPlace: false, fromLinks: false });
  });

  it("uses sessionStorage on request, leaving out the runtime's and panel's own keys", () => {
    sessionStorage.setItem('state-scenarios:active', '{}');
    sessionStorage.setItem('scenario-panel:open', '1');
    const adapter = storageAdapter({ area: 'session' });
    void adapter.apply({ step: '2' });

    expect(adapter.key).toBe('sessionStorage');
    expect(adapter.read?.()).toEqual({ step: '2' });
  });
});

describe('namedHandlers', () => {
  it('collects every handler or list of handlers a module exports, first module first', () => {
    const empty = http.get('*/clients', () => HttpResponse.json([]));
    const both = [http.get('*/a', () => HttpResponse.json(1)), http.get('*/b', () => HttpResponse.json(2))];
    const other = http.get('*/clients', () => HttpResponse.json([1]));

    const named = namedHandlers(
      { ordersEmpty: empty, pair: both, makeHandlers: () => [], ids: ['a'], none: [] },
      { ordersEmpty: other, extra: other },
    );

    expect(named).toEqual({ ordersEmpty: [empty], pair: both, extra: [other] });
  });
});
