import type { SetupWorker } from 'msw/browser';
import type { z } from 'zod';
import { type Catalog, createCatalog, type ScenarioRule } from './catalog.js';
import { DATA_KEY, PARAM, readInline, scenarioHref, STRICT_PARAM } from './link.js';
import {
  type Json,
  parseJson,
  parseScenario,
  type Scenario,
  type ScenarioInput,
  type Serializable,
} from './schema.js';

const STORAGE_KEY = 'state-scenarios:active';

interface AdapterBase {
  /** Key under `scenario.state` this adapter reads. */
  key: string;
  /** Current state as JSON, for the panel's live editor and "Save as scenario". */
  read?(): Json;
  /** Call `onChange` when the state changes; return an unsubscribe. */
  subscribe?(onChange: () => void): () => void;
  /** False when new state only takes effect on a reload, e.g. a snapshot an actor starts from. */
  inPlace?: boolean;
  /**
   * False to apply this state from catalog scenarios only, and skip it for inline links.
   * For state that outlives the scenario, such as a cookie the real backend reads.
   */
  fromLinks?: boolean;
}

/** Decodes scenario JSON with `schema`, so `apply` receives typed state. */
export interface TypedAdapter<T> extends AdapterBase {
  /** Also feeds `scenarioJsonSchema`. */
  schema: z.ZodType<T>;
  apply(state: T): void | Promise<void>;
}

/** Receives the scenario's JSON as it is. */
export interface JsonAdapter extends AdapterBase {
  schema?: undefined;
  apply(state: Json): void | Promise<void>;
}

/** Connects one slice of app state (a store, a cache, a reducer) to scenarios and the panel. */
export type Adapter<T = Json> = TypedAdapter<T> | JsonAdapter;

export interface Connection<T extends Serializable> {
  /** Push the app's current state (for state the library can't `read`, e.g. useReducer). */
  update(state: T): void;
  disconnect(): void;
}

export interface StartOptions {
  /** Scenario objects, e.g. `import.meta.glob<ScenarioInput>('./scenarios/*.json')`, or built in code. */
  scenarios: ScenarioInput[];
  /** Scenario to use when the URL names none. Omit to leave the app untouched. */
  defaultScenario?: string;
  /** Adapters available before render. Components can `connect` more later. */
  adapters?: Adapter<unknown>[];
  rules?: ScenarioRule[];
  /**
   * Answer unmatched requests with 501 instead of passing them to the real network.
   * Assets and page loads always pass. Also switched on by `?scenario-strict`.
   */
  strict?: boolean;
  /** Requests that may reach the network in strict mode (URL substring or RegExp). */
  allow?: (string | RegExp)[];
  /**
   * Called after an in-place switch changes network fixtures, so the app refetches,
   * e.g. `() => queryClient.resetQueries()`. Without it, such switches reload the page.
   */
  refresh?: () => void | Promise<void>;
  /**
   * The app's own MSW worker (or a `setupServer()` in tests), instead of starting one.
   * Its handlers stay active beneath the scenario's, and are restored by `destroy()`.
   * The app owns its lifecycle: start it before `startScenarios`.
   */
  worker?: MswWorker;
  /** Passed to `worker.start()` when state-scenarios starts its own worker. */
  workerOptions?: Parameters<SetupWorker['start']>[0];
}

/** The parts of an MSW worker or server state-scenarios uses. */
export type MswWorker = Pick<SetupWorker, 'resetHandlers' | 'listHandlers'>;

export interface ScenarioSession {
  catalog: Catalog;
  /** The scenario as authored (with `extends`), or null when none is active. */
  active: Scenario | null;
  /** The active scenario with `extends` flattened. */
  resolved: Scenario | null;
  strict: boolean;
  /** Non-asset requests no scenario entry matched (live list). */
  unhandled: string[];
  /** Keys of connected adapters. */
  keys(): string[];
  /** The connected adapter's current state, as JSON. */
  read(key: string): Json | undefined;
  /** Validate and apply state to a connected adapter now, without changing scenario. */
  applyState(key: string, state: Json): Promise<void>;
  /** Connect an adapter; the active scenario's state for its key is applied at once. */
  connect<T extends Serializable>(adapter: Adapter<T>): Connection<T>;
  /**
   * Switch to a catalog scenario: in place when only connected state (or network, with
   * `refresh`) changes, otherwise by reloading. Names combine: "signed-in,server-error".
   */
  open(names: string): Promise<void>;
  /** Switch to a scenario that isn't in the catalog, e.g. one edited in the panel. */
  openInline(scenario: Scenario): Promise<void>;
  onChange(listener: () => void): () => void;
  /**
   * Tear down: unsubscribe adapters, drop listeners and queued switches, and stop the
   * worker this session started (or restore the app's own worker's handlers).
   * For HMR and unmounting. The page keeps whatever state it shows.
   */
  destroy(): void;
}

/** An adapter with its type erased behind decode-then-apply. */
interface Bound {
  key: string;
  /** Validate now; the returned function applies. */
  decode(state: Json, scenario: string): () => void | Promise<void>;
  /** Undefined when the adapter can't read (state is pushed through `connection.update`). */
  read(): Json | undefined;
  subscribe(onChange: () => void): (() => void) | undefined;
  inPlace: boolean;
  fromLinks: boolean;
}

function bind<T>(adapter: Adapter<T>): Bound {
  return {
    key: adapter.key,
    read: () => adapter.read?.(),
    subscribe: (onChange) => adapter.subscribe?.(onChange),
    inPlace: adapter.inPlace !== false,
    fromLinks: adapter.fromLinks !== false,
    decode(state, scenario) {
      if (adapter.schema === undefined) return () => adapter.apply(state);
      const parsed = adapter.schema.safeParse(state);

      if (!parsed.success) {
        throw new Error(`Scenario "${scenario}": invalid state["${adapter.key}"]: ${parsed.error.message}`);
      }

      return () => adapter.apply(parsed.data);
    },
  };
}

interface Connected {
  adapter: Bound;
  /** Last state pushed through `connection.update`; converted to JSON when read. */
  value?: Serializable;
  unsubscribe?: () => void;
}

let current: ScenarioSession | null = null;

/** The session whose scenario the <html> markers describe; only it may clear them. */
let markerOwner: ScenarioSession | null = null;

/** The session started by `startScenarios`, if any (null in production builds that skip it). */
export const currentSession = () => current;

interface Selection {
  name?: string;
  data?: string;
  strict?: boolean;
}

/**
 * Read the scenario from the URL (or the tab's last one), mock the network if the
 * scenario needs it, apply URL and adapter state. Await this before rendering the app.
 */
export async function startScenarios(options: StartOptions): Promise<ScenarioSession> {
  const catalog = createCatalog(options.scenarios, { rules: options.rules });
  const url = new URL(location.href);
  const selection = select(url, options.defaultScenario);
  const unhandled: string[] = [];
  globalThis.stateScenariosUnhandled = unhandled;

  const connected = new Map<string, Connected>();
  const listeners = new Set<() => void>();

  // One failing listener (a panel, an app hook) must not stop the others or fail a switch.
  const emit = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[state-scenarios] onChange listener failed', err);
      }
    }
  };

  // The app's worker, if given, else one this session starts on first need.
  let worker: MswWorker | null = options.worker ?? null;
  let ownWorker: SetupWorker | null = null;
  const appHandlers = options.worker ? [...options.worker.listHandlers()] : [];
  let destroyed = false;

  // Whether the active scenario came from an inline link.
  let fromLink = false;

  /** Validate every adapter's state up front, so nothing changes if any of it is invalid. */
  const prepareStates = (resolved: Scenario, adapters: Bound[], link = fromLink) =>
    adapters.flatMap((adapter) => {
      const state = resolved.state?.[adapter.key];

      if (state === undefined) return [];

      if (link && !adapter.fromLinks) {
        console.warn(`[state-scenarios] ignored state.${adapter.key}: a link can't set it`);

        return [];
      }

      return [adapter.decode(state, resolved.name)];
    });

  const applyPrepared = async (prepared: ReturnType<typeof prepareStates>) => {
    for (const apply of prepared) {
      // Destroyed while an earlier adapter was applying: leave the rest untouched.
      if (destroyed) return;
      await apply();
    }
  };

  const boundAdapters = () => [...connected.values()].map((entry) => entry.adapter);

  // MSW loads only when a scenario mocks the network or strict mode needs a catch-all.
  const setNetwork = async (resolved: Scenario) => {
    if (!resolved.network?.length && !session.strict && !worker) return;
    const [{ toHandlers }, msw] = await Promise.all([import('./network.js'), import('msw')]);

    if (destroyed) return;
    const allow = options.allow ?? [];

    const fallback = msw.http.all('*', ({ request }) => {
      const { pathname } = new URL(request.url);
      const isPage = request.mode === 'navigate' || !!request.headers.get('accept')?.includes('text/html');

      const allowed = allow.some((rule) =>
        rule instanceof RegExp ? rule.test(request.url) : request.url.includes(rule)
      );

      if (isPage || isAsset(request.url) || pathname.startsWith('/@') || allowed) {
        return msw.passthrough();
      }

      const label = `${request.method} ${request.url}`;
      unhandled.push(label);
      emit();

      if (!session.strict) return msw.passthrough();
      console.error(`[state-scenarios] "${resolved.name}" has no handler for ${label}`);

      return msw.HttpResponse.json({ message: `No scenario handler for ${label}` }, { status: 501 });
    });

    // Scenario first, then the app's own handlers, then the catch-all.
    const handlers = [...toHandlers(resolved.network), ...appHandlers, fallback];

    if (worker) {
      worker.resetHandlers(...handlers);

      return;
    }

    const { setupWorker } = await import('msw/browser');
    const started = setupWorker(...handlers);
    await started.start({ quiet: true, ...options.workerOptions });

    // Destroyed while starting: don't leave a worker running.
    if (destroyed) {
      void started.stop();

      return;
    }

    worker = ownWorker = started;
  };

  const activate = (active: Scenario, resolved: Scenario, link: boolean) => {
    fromLink = link;
    session.active = active;
    session.resolved = resolved;
    // Tests and agents wait on these: html[data-scenario="name"], then the ready selector.
    const html = document.documentElement;
    markerOwner = session;
    html.dataset.scenario = resolved.name;

    if (resolved.ready) html.dataset.scenarioReady = resolved.ready;
    else delete html.dataset.scenarioReady;
  };

  let transition = 0;
  let queue: Promise<void> = Promise.resolve();

  const switchTo = async (next: Scenario, inline: boolean) => {
    const resolved = catalog.resolve(next);
    // Validate before choosing reload or in place: a rejected switch must leave the app as it was.
    const prepared = prepareStates(resolved, boundAdapters(), inline);

    const prev = session.resolved;
    const nextKeys = Object.keys(resolved.state ?? {});
    // Opening a scenario always restarts its network: fresh handler sequences, refetched data.
    const mocksNetwork = worker !== null || !!resolved.network?.length || session.strict;

    const href = scenarioHref(resolved, { inline, strict: session.strict });

    const inPlace = prev !== null
      // Compare with the app's actual URL: URL-driven UI only resets on a reload.
      && new URL(href).pathname === location.pathname
      && JSON.stringify(appParams(location.search)) === JSON.stringify(sortedParams(resolved.url))
      && (!mocksNetwork || !!options.refresh)
      // Can't un-apply state, and can't apply state nobody is connected to receive.
      && Object.keys(prev.state ?? {}).every((k) => nextKeys.includes(k))
      && nextKeys.every((k) => connected.get(k)?.adapter.inPlace === true);

    if (!inPlace) {
      navigate(href);

      return;
    }

    // After every await: a destroyed session must not touch the app, URL or storage.
    if (mocksNetwork) {
      await setNetwork(resolved);

      if (destroyed) return;
      // Kick off the refetch but don't wait: a scenario may hold requests open forever.
      Promise.resolve(options.refresh?.()).catch((err) => console.error('[state-scenarios]', err));
    }

    await applyPrepared(prepared);

    if (destroyed) return;
    unhandled.splice(0);
    activate(next, resolved, inline);
    const at = new URL(href);
    history.replaceState(history.state, '', at);
    const data = readInline(at.hash);
    store(data ? { data, strict: session.strict } : { name: next.name, strict: session.strict });
    emit();
  };

  // Switches run one at a time, and one superseded while queued is skipped,
  // so a slow earlier switch can never land on top of a later one.
  const enqueue = (next: () => Scenario, inline: boolean) => {
    if (destroyed) return Promise.reject(new Error('This scenario session was destroyed'));
    const id = ++transition;
    const run = queue.then(() => (id === transition ? switchTo(next(), inline) : undefined));
    queue = run.catch(() => {});

    return run;
  };

  const attach = (adapter: Bound): Connection<Serializable> => {
    const entry: Connected = { adapter };
    connected.set(adapter.key, entry);
    entry.unsubscribe = adapter.subscribe?.(emit);
    emit();

    return {
      update(state) {
        entry.value = state;
        emit();
      },
      disconnect() {
        entry.unsubscribe?.();

        if (connected.get(adapter.key) === entry) connected.delete(adapter.key);
        emit();
      },
    };
  };

  const session: ScenarioSession = {
    catalog,
    active: null,
    resolved: null,
    strict: options.strict ?? !!selection?.strict,
    unhandled,
    keys: () => [...connected.keys()],
    read(key) {
      const entry = connected.get(key);
      const read = entry?.adapter.read();

      if (read !== undefined) return read;

      return entry?.value === undefined ? undefined : parseJson(JSON.stringify(entry.value));
    },
    async applyState(key, state) {
      const entry = connected.get(key);

      if (!entry) throw new Error(`No adapter connected for "${key}"`);
      await entry.adapter.decode(state, session.active?.name ?? 'live')();
    },
    connect(adapter) {
      const bound = bind(adapter);
      const noop = { update() {}, disconnect() {} };

      if (destroyed) return noop;
      const connection = attach(bound);

      if (session.resolved) {
        applyPrepared(prepareStates(session.resolved, [bound])).catch((err) =>
          console.error('[state-scenarios]', err)
        );
      }

      return connection;
    },
    open: (names) => enqueue(() => lookup(catalog, names), false),
    openInline: (scenario) => enqueue(() => scenario, true),
    onChange(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      transition++; // drop queued switches

      for (const entry of connected.values()) entry.unsubscribe?.();
      connected.clear();
      listeners.clear();

      if (ownWorker) void ownWorker.stop();
      else worker?.resetHandlers(...appHandlers);
      worker = ownWorker = null;

      if (current === session) current = null;

      if (globalThis.stateScenariosUnhandled === unhandled) globalThis.stateScenariosUnhandled = undefined;

      if (markerOwner === session) {
        markerOwner = null;
        delete document.documentElement.dataset.scenario;
        delete document.documentElement.dataset.scenarioReady;
      }
    },
  };

  current = session;

  // Adapters connect whether or not a scenario is selected, so the plain app can be
  // inspected and captured too. Only applying scenario state is conditional.
  const initial = (options.adapters ?? []).map(bind);

  for (const adapter of initial) attach(adapter);

  if (!selection) return session;

  // A selection that doesn't load must not stick to the tab and break every later page load.
  const loaded = (() => {
    try {
      const active = selection.data
        ? parseScenario(JSON.parse(selection.data), 'inline scenario')
        : lookup(catalog, selection.name ?? '');

      const resolved = catalog.resolve(active);

      return { active, resolved, prepared: prepareStates(resolved, initial, !!selection.data) };
    } catch (err) {
      store(null);
      throw err;
    }
  })();

  const { active, resolved, prepared } = loaded;
  await setNetwork(resolved);

  if (destroyed) return session;

  // Only fill params that are missing, so in-app navigation survives a reload.
  for (const [k, v] of Object.entries(resolved.url ?? {})) {
    if (v !== null && !url.searchParams.has(k)) url.searchParams.set(k, v);
  }

  history.replaceState(history.state, '', url);
  // Apply (awaiting async adapters) before the app renders.
  await applyPrepared(prepared);

  if (destroyed) return session;
  activate(active, resolved, !!selection.data);
  emit();

  return session;
}

/** msw's `isCommonAssetRequest`, inlined so msw 2.4 and later all work. */
const isAsset = (href: string) => {
  const url = new URL(href);

  return url.protocol === 'file:' || url.hostname === 'fonts.googleapis.com'
    || url.pathname.includes('node_modules') || url.pathname.includes('@vite')
    || /\.(s?css|less|m?jsx?|m?tsx?|html|ttf|otf|woff2?|eot|gif|jpe?g|png|avif|webp|svg|mp4|webm|ogg|mov|mp3|wav|flac|aac|pdf|txt|csv|json|xml|md|zip|tar|gz|rar|7z)$/i
      .test(url.pathname);
};

const byKey = ([a]: [string, string | null], [b]: [string, string | null]) => a.localeCompare(b);

/** The app's own query params (scenario params excluded), sorted for comparison. */
const appParams = (search: string) =>
  [...new URLSearchParams(search)].filter(([k]) => k !== PARAM && k !== STRICT_PARAM).toSorted(byKey);

const sortedParams = (url: Scenario['url']) =>
  Object.entries(url ?? {}).filter(([, v]) => v !== null).toSorted(byKey);

/** Go to a scenario link, reloading even when only the hash changes. */
export function navigate(href: string) {
  const next = new URL(href, location.href);

  if (next.pathname + next.search === location.pathname + location.search) {
    history.replaceState(history.state, '', next);
    location.reload();
  } else {
    location.href = next.toString();
  }
}

/**
 * URL first (`?scenario=name` or `#scenario-data=...`), then the tab's last
 * selection, so navigation that drops the query keeps the scenario.
 * `?scenario=` (empty) resets to the default.
 */
function select(url: URL, fallback?: string): Selection | null {
  const data = readInline(url.hash);
  const name = url.searchParams.get(PARAM);
  const strict = url.searchParams.has(STRICT_PARAM);

  let selection: Selection | null = null;

  if (data) selection = { data, strict };
  else if (name) selection = { name, strict };
  else if (name === '') {
    url.searchParams.delete(PARAM);
    store(null);
  } else {
    const stored = load();
    // An explicit ?scenario-strict in the current URL wins over the stored flag.
    selection = stored && { ...stored, strict: stored.strict || strict };

    // Restore the selection into the URL so it stays shareable.
    if (selection?.name) url.searchParams.set(PARAM, selection.name);

    if (selection?.data) url.hash = new URLSearchParams({ [DATA_KEY]: selection.data }).toString();

    if (selection?.strict) url.searchParams.set(STRICT_PARAM, '');
  }

  if (selection) store(selection);

  return selection ?? (fallback ? { name: fallback, strict } : null);
}

/** One name, or several joined with commas: later ones win, like `extends`. */
function lookup(catalog: Catalog, names: string): Scenario {
  const list = names.split(',').map((n) => n.trim());

  for (const name of list) {
    if (catalog.get(name)) continue;
    const known = catalog.list.map((s) => s.name).join(', ');
    throw new Error(`Unknown scenario "${name}". Known scenarios: ${known}`);
  }

  const [only] = list;
  const single = list.length === 1 && only !== undefined ? catalog.get(only) : undefined;

  return single ?? { name: list.join(','), extends: list };
}

function store(selection: Selection | null) {
  try {
    if (selection) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function load(): Selection | null {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
