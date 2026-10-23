import { delay, http, HttpResponse, type RequestHandler } from 'msw';
import { isCode } from './code.js';
import type { NetworkEntry } from './schema.js';

const verbs = {
  GET: http.get,
  POST: http.post,
  PUT: http.put,
  PATCH: http.patch,
  DELETE: http.delete,
  HEAD: http.head,
  OPTIONS: http.options,
} satisfies Record<NetworkEntry['method'], typeof http.get>;

export { isCode };

/** Turn scenario network entries into MSW handlers. First match wins. */
export function toHandlers(entries: NetworkEntry[] = []) {
  return entries.map((entry) => {
    const responses = entry.sequence ?? [entry.response!];
    let calls = 0;

    return verbs[entry.method](entry.path, async ({ request }): Promise<Response | undefined> => {
      // Fixtures answer the app's requests, never a page load or code: a scenario from a shared
      // link could otherwise serve its own HTML or scripts (a lazy chunk) on the app's origin.
      if (request.mode === 'navigate' || isCode(request.url)) return undefined;

      if (entry.query) {
        const params = new URL(request.url).searchParams;
        const matches = Object.entries(entry.query).every(([k, v]) => params.get(k) === v);

        if (!matches) return undefined; // fall through to the next handler
      }

      const r = responses[Math.min(calls++, responses.length - 1)];

      if (r.delay !== undefined) await delay(r.delay);
      // nosniff stops a browser running a fixture as a script, whatever URL loaded it.
      const headers = new Headers(r.headers);
      headers.set('x-content-type-options', 'nosniff');

      if (/script|wasm/i.test(headers.get('content-type') ?? '')) return undefined;
      const init = { status: r.status, headers };

      if (r.text !== undefined) return HttpResponse.text(r.text, init);

      if (r.body === undefined) return new HttpResponse(null, init);

      return HttpResponse.json(r.body, init);
    });
  });
}

/** MSW handlers by the name a scenario's `"handlers"` uses. */
export type NamedHandlers = Record<string, RequestHandler[]>;

// Duck-typed: the app's handlers may come from another copy of msw than this package's.
const isHandler = (value: unknown): value is RequestHandler =>
  value instanceof Object && 'run' in value && 'info' in value;

/**
 * Every export of these modules that is an MSW handler or a list of them, by export name, for
 * `startScenarios({ handlers })`: `import * as mocks from './mocks/handlers'` makes each
 * `export const ordersEmpty = http.get(…)` usable as `"handlers": ["ordersEmpty"]`.
 * On a name both modules export, the first module wins.
 */
export function namedHandlers(...modules: object[]): NamedHandlers {
  const named = new Map<string, RequestHandler[]>();

  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) {
      const list = [value].flat();

      if (!named.has(name) && list.length && list.every(isHandler)) named.set(name, list);
    }
  }

  return Object.fromEntries(named);
}
