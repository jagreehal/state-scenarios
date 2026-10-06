import { delay, http, HttpResponse } from 'msw';
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

/** Turn scenario network entries into MSW handlers. First match wins. */
export function toHandlers(entries: NetworkEntry[] = []) {
  return entries.map((entry) => {
    const responses = entry.sequence ?? [entry.response!];
    let calls = 0;

    return verbs[entry.method](entry.path, async ({ request }): Promise<Response | undefined> => {
      if (entry.query) {
        const params = new URL(request.url).searchParams;
        const matches = Object.entries(entry.query).every(([k, v]) => params.get(k) === v);

        if (!matches) return undefined; // fall through to the next handler
      }

      const r = responses[Math.min(calls++, responses.length - 1)];

      if (r.delay !== undefined) await delay(r.delay);
      const init = { status: r.status, headers: r.headers };

      if (r.text !== undefined) return HttpResponse.text(r.text, init);

      if (r.body === undefined) return new HttpResponse(null, init);

      return HttpResponse.json(r.body, init);
    });
  });
}
