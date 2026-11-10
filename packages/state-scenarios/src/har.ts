import { z } from 'zod';
import { type RecordedCall, toNetwork } from './record.js';
import { redactQuery, redactSecrets } from './redact.js';
import { type Json, MethodSchema, type NetworkEntry, parseJson } from './schema.js';

const HarSchema = z.object({
  log: z.object({
    entries: z.array(z.object({
      startedDateTime: z.string(),
      request: z.object({ method: z.string(), url: z.string() }),
      response: z.object({
        status: z.number(),
        content: z.object({
          mimeType: z.string().optional(),
          text: z.string().optional(),
          encoding: z.string().optional(),
        }),
      }),
    })),
  }),
});

export interface HarImport {
  network: NetworkEntry[];
  /** Fields replaced with "[redacted]" or left out, e.g. "GET /api/me: body.token". */
  redacted: string[];
  /** Requests left out, and why. */
  skipped: string[];
}

const text = (content: { text?: string; encoding?: string; }) =>
  content.encoding === 'base64' && content.text !== undefined
    ? new TextDecoder().decode(Uint8Array.from(atob(content.text), (c) => c.charCodeAt(0)))
    : content.text;

/**
 * The JSON responses in a HAR file (DevTools > Network > Save all as HAR) as scenario network
 * entries, redacted like recordings. Paths start with `*` so the scenario replays on any host:
 * a HAR saved from production opens on localhost. Repeated calls become a `sequence`.
 */
export function fromHar(har: Json): HarImport {
  const { log } = HarSchema.parse(har);
  const calls: RecordedCall[] = [];
  const redacted: string[] = [];
  const skipped: string[] = [];

  const ordered = log.entries
    .map((entry, i) => ({ entry, i, at: Date.parse(entry.startedDateTime) }))
    .toSorted((a, b) => a.at - b.at || a.i - b.i);

  for (const { entry: { request, response }, i } of ordered) {
    const label = `${request.method} ${request.url}`;
    const method = MethodSchema.safeParse(request.method.toUpperCase());

    if (!response.content.mimeType?.includes('json') || response.status === 0 || !method.success) continue;
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];

    // Scenario queries hold one value per key.
    if (new Set(keys).size < keys.length) {
      skipped.push(`${label}: repeats a query key`);
      continue;
    }

    const { query, dropped } = redactQuery(Object.fromEntries(url.searchParams));

    const call: RecordedCall = {
      order: i,
      method: method.data,
      path: `*${url.pathname}`,
      query,
      status: response.status,
    };

    const where = `${method.data} ${url.pathname}`;
    redacted.push(...dropped.map((k) => `${where}: query ${k}`));

    try {
      const body = text(response.content);

      if (body) {
        const { value, redacted: fields } = redactSecrets(parseJson(body));
        call.body = value;
        redacted.push(...fields.map((f) => `${where}: ${f}`));
      }
    } catch {
      skipped.push(`${label}: body isn't valid JSON (or wasn't saved in the HAR)`);
      continue;
    }

    calls.push(call);
  }

  return { network: toNetwork(calls), redacted, skipped };
}
