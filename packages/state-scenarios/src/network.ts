import { delay, http, HttpResponse, type RequestHandler } from 'msw';
import { z } from 'zod';
import { isCode } from './code.js';
import type { RequestCheck } from './request-checks.js';
import { type Json, JsonSchema, type NetworkEntry, parseJson } from './schema.js';

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

export { type RequestCheck, requestProblems, suspiciousUrl } from './request-checks.js';

/**
 * Turn scenario network entries into MSW handlers. First match wins. Pass `checks` to collect
 * what entries with `expect` saw; read it with `requestProblems`.
 */
export function toHandlers(entries: NetworkEntry[] = [], checks?: RequestCheck[]) {
  return entries.map((entry) => {
    const responses = entry.sequence ?? [entry.response!];

    // Generated once, when the scenario opens: a bad $repeat fails the switch, not a request.
    const bodies = responses.map((r) => (r.body === undefined ? undefined : expandBody(r.body)));
    let calls = 0;

    const query = entry.query ? `?${new URLSearchParams(entry.query)}` : '';

    const check: RequestCheck | undefined = entry.expect
      && { entry: `${entry.method} ${entry.path}${query}`, sent: 0, mismatches: [] };

    if (check) checks?.push(check);

    return verbs[entry.method](entry.path, async ({ request }): Promise<Response | undefined> => {
      // Fixtures answer the app's requests, never a page load or code: a scenario from a shared
      // link could otherwise serve its own HTML or scripts (a lazy chunk) on the app's origin.
      if (request.mode === 'navigate' || isCode(request.url)) return undefined;

      if (entry.query) {
        const params = new URL(request.url).searchParams;
        const matches = Object.entries(entry.query).every(([k, v]) => params.get(k) === v);

        if (!matches) return undefined; // fall through to the next handler
      }

      if (check && entry.expect) {
        check.sent++;
        const problems = await compareRequest(entry.expect, request.clone());

        if (problems.length) {
          check.mismatches.push(`${request.method} ${request.url}: ${problems.join('; ')}`);
        }
      }

      const index = Math.min(calls++, responses.length - 1);
      const r = responses[index];
      const body = bodies[index];

      if (r.delay !== undefined) await delay(r.delay);
      // nosniff stops a browser running a fixture as a script, whatever URL loaded it.
      const headers = new Headers(r.headers);
      headers.set('x-content-type-options', 'nosniff');

      if (/script|wasm/i.test(headers.get('content-type') ?? '')) return undefined;
      const init = { status: r.status, headers };

      if (r.text !== undefined) return HttpResponse.text(r.text, init);

      if (body === undefined) return new HttpResponse(null, init);

      return HttpResponse.json(body, init);
    });
  });
}

type Expectation = NonNullable<NetworkEntry['expect']>;

const shown = (value: Json | undefined) => {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);

  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** How a request differs from an entry's `expect`, one line per difference. */
async function compareRequest(expect: Expectation, request: Request): Promise<string[]> {
  const params = new URL(request.url).searchParams;

  const problems = Object.entries(expect.query ?? {}).flatMap(([key, want]) => {
    const got = params.get(key);

    return got === want ? [] : [`query ${key}: expected ${want ?? 'absent'}, got ${got ?? 'absent'}`];
  });

  if (expect.body === undefined) return problems;
  const text = await request.text();
  // A body that isn't JSON is compared as text.
  let body: Json | undefined = text || undefined;

  try {
    body = parseJson(text);
  } catch {}

  return [...problems, ...subsetDiff(expect.body, body, 'body')];
}

const isRecord = (value: Json | undefined): value is { [key: string]: Json; } =>
  value instanceof Object && !Array.isArray(value);

/** Where `actual` differs from `expected`, checking only the keys `expected` lists. */
function subsetDiff(expected: Json, actual: Json | undefined, path: string): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [`${path}: expected ${expected.length} item(s), got ${shown(actual)}`];
    }

    return expected.flatMap((item, i) => subsetDiff(item, actual[i], `${path}[${i}]`));
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) return [`${path}: expected an object, got ${shown(actual)}`];

    return Object.entries(expected).flatMap(([key, item]) => subsetDiff(item, actual[key], `${path}.${key}`));
  }

  return Object.is(expected, actual) ? [] : [`${path}: expected ${shown(expected)}, got ${shown(actual)}`];
}

/** The most items `$repeat` may generate in one body, nested repeats multiplied, so a typo can't freeze the tab. */
export const MAX_REPEAT = 100_000;

const RepeatSchema = z.strictObject({ $repeat: z.number().int().min(0).max(MAX_REPEAT), item: JsonSchema });

/**
 * A response body with each `{ "$repeat": n, "item": … }` replaced by n copies of `item`, for
 * long lists and paging. In strings, `{{i}}` becomes the copy's number from 1; a string that is
 * only `{{i}}` becomes the number itself.
 */
export function expandBody(value: Json, budget = { left: MAX_REPEAT }): Json {
  if (Array.isArray(value)) return value.map((v) => expandBody(v, budget));

  if (!isRecord(value)) return value;

  if ('$repeat' in value) {
    const parsed = RepeatSchema.safeParse(value);

    if (!parsed.success) {
      throw new Error(
        `"$repeat" takes { "$repeat": <0 to ${MAX_REPEAT}>, "item": <JSON> } and nothing else: ${parsed.error.message}`,
      );
    }

    const before = budget.left;
    const item = expandBody(parsed.data.item, budget);
    const inner = before - budget.left;
    const n = parsed.data.$repeat;
    // n copies of the item and of everything generated inside it, which is charged once already.
    budget.left -= n + (n - 1) * inner;

    if (budget.left < 0) throw new Error(`"$repeat" generates more than ${MAX_REPEAT} items in one body`);

    return Array.from({ length: parsed.data.$repeat }, (_, i) => numbered(item, i + 1));
  }

  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandBody(v, budget)]));
}

const Text = z.string();

function numbered(value: Json, i: number): Json {
  const text = Text.safeParse(value);

  if (text.success) return text.data === '{{i}}' ? i : text.data.replaceAll('{{i}}', String(i));

  if (Array.isArray(value)) return value.map((v) => numbered(v, i));

  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, numbered(v, i)]));
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
