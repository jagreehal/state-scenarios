import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { failurePage, type Inspection } from '../packages/state-scenarios-cli/src/inspect.ts';
import { fromHar } from '../packages/state-scenarios/src/har.ts';
import {
  expandBody,
  type RequestCheck,
  requestProblems,
  suspiciousUrl,
  toHandlers,
} from '../packages/state-scenarios/src/network.ts';
import { type Json, parseScenario, type ScenarioInput } from '../packages/state-scenarios/src/schema.ts';

const entries = (network: ScenarioInput['network']) => parseScenario({ name: 't', network }).network;

describe('expect on network entries', () => {
  const setup = () => {
    const checks: RequestCheck[] = [];

    const handlers = toHandlers(
      entries([
        {
          method: 'POST',
          path: 'http://api.test/orders/export',
          expect: { query: { type: 'all', draft: null }, body: { ids: [1, 2], filter: { status: 'open' } } },
          response: { status: 202 },
        },
        {
          method: 'GET',
          path: 'http://api.test/orders',
          expect: { query: { page: '1' } },
          response: { body: [] },
        },
      ]),
      checks,
    );

    const send = (url: string, body?: Json) =>
      getResponse(
        handlers,
        new Request(url, {
          method: body ? 'POST' : 'GET',
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );

    return { checks, send };
  };

  it('passes a request that matches, ignoring keys expect leaves out', async () => {
    const { checks, send } = setup();

    const res = await send('http://api.test/orders/export?type=all', {
      ids: [1, 2],
      filter: { status: 'open', page: 3 },
      extra: true,
    });

    expect(res?.status).toBe(202);
    expect(requestProblems(checks)).toEqual(['GET http://api.test/orders: never sent']);
  });

  it('still answers a request that differs, and says how it differs', async () => {
    const { checks, send } = setup();
    const res = await send('http://api.test/orders/export?draft=1', { ids: [1], filter: {} });

    expect(res?.status).toBe(202);
    expect(requestProblems(checks)[0]).toBe(
      'POST http://api.test/orders/export?draft=1: query type: expected all, got absent; '
        + 'query draft: expected absent, got 1; body.ids: expected 2 item(s), got [1]; '
        + 'body.filter.status: expected "open", got nothing',
    );
  });

  it('rejects unknown keys in expect', () => {
    expect(() =>
      parseScenario(
        JSON.parse('{"name":"t","network":[{"path":"/a","expect":{"headers":{}},"response":{}}]}'),
      )
    )
      .toThrow();
  });
});

describe('$repeat', () => {
  it('generates numbered copies, nested too', () => {
    expect(
      expandBody({
        total: 2,
        rows: { $repeat: 2, item: { id: '{{i}}', name: 'Row {{i}}', tags: { $repeat: 1, item: 't{{i}}' } } },
      }),
    ).toEqual({
      total: 2,
      rows: [{ id: 1, name: 'Row 1', tags: ['t1'] }, { id: 2, name: 'Row 2', tags: ['t1'] }],
    });
  });

  it('is expanded when a handler answers', async () => {
    const handlers = toHandlers(
      entries([{ path: 'http://api.test/rows', response: { body: { $repeat: 3, item: { id: '{{i}}' } } } }]),
    );

    const res = await getResponse(handlers, new Request('http://api.test/rows'));

    expect(await res?.json()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('refuses a bad or huge $repeat when the scenario opens', () => {
    expect(() => expandBody({ $repeat: 1e9, item: 1 })).toThrow(/\$repeat/);
    expect(() => expandBody({ $repeat: 2, item: 1, extra: true })).toThrow(/\$repeat/);
    // Nested repeats multiply: 1,000 x 1,000 passes each cap alone.
    expect(() => expandBody({ $repeat: 1000, item: { $repeat: 1000, item: 1 } })).toThrow(/more than/);
    expect(expandBody({ $repeat: 3, item: { lines: { $repeat: 2, item: 1 } } })).toHaveLength(3);
  });
});

describe('suspiciousUrl', () => {
  it.each([
    ['http://a.test/users//orders', 'empty path segment (//)'],
    ['http://a.test/users/undefined/orders', 'path segment "undefined"'],
    ['http://a.test/items/%5Bobject%20Object%5D', 'path segment "[object Object]"'],
    ['http://a.test/items?id=NaN', 'query id=NaN'],
    ['http://a.test/items?owner=null', 'query owner=null'],
  ])('flags %s', (url, why) => expect(suspiciousUrl(url)).toBe(why));

  it.each(['http://a.test/', 'http://a.test/users/42/orders?page=2', 'http://a.test/null-island?q=nullable'])(
    'passes %s',
    (url) => expect(suspiciousUrl(url)).toBeUndefined(),
  );
});

describe('fromHar', () => {
  const entry = (
    method: string,
    url: string,
    status: number,
    text: string,
    mimeType = 'application/json',
  ) => ({
    startedDateTime: '2026-01-01T00:00:00.000Z',
    request: { method, url },
    response: { status, content: { mimeType, text } },
  });

  it('turns JSON responses into redacted entries that replay on any host', () => {
    const { network, redacted, skipped } = fromHar({
      log: {
        entries: [
          entry(
            'GET',
            'https://prod.example.com/api/me?access_token=abc',
            200,
            JSON.stringify({ name: 'Ada', apiKey: 'k1' }),
          ),
          entry('GET', 'https://prod.example.com/', 200, '<html>', 'text/html'),
          entry(
            'GET',
            'https://prod.example.com/api/orders?page=1',
            500,
            JSON.stringify({ message: 'down' }),
          ),
          entry('GET', 'https://prod.example.com/api/orders?page=1', 200, '[]'),
          entry('GET', 'https://prod.example.com/api/tags?t=a&t=b', 200, '[]'),
          entry('GET', 'https://prod.example.com/api/broken', 200, '{nope'),
        ],
      },
    });

    expect(network).toEqual([
      {
        method: 'GET',
        path: '*/api/orders',
        query: { page: '1' },
        sequence: [{ status: 500, body: { message: 'down' } }, { status: 200, body: [] }],
      },
      {
        method: 'GET',
        path: '*/api/me',
        response: { status: 200, body: { name: 'Ada', apiKey: '[redacted]' } },
      },
    ]);
    expect(redacted).toEqual(['GET /api/me: query access_token', 'GET /api/me: apiKey']);
    expect(skipped).toHaveLength(2);
  });

  it('decodes base64 bodies', () => {
    const har = {
      log: {
        entries: [{
          ...entry('GET', 'https://x.test/a', 200, ''),
          response: {
            status: 200,
            content: { mimeType: 'application/json', text: btoa('{"ok":true}'), encoding: 'base64' },
          },
        }],
      },
    };

    expect(fromHar(har).network[0]?.response?.body).toEqual({ ok: true });
  });
});

describe('failure pages for request checks', () => {
  it('list mismatches and suspicious URLs', () => {
    const page = failurePage(
      {
        name: 'x',
        ok: false,
        codes: ['REQUEST_MISMATCH', 'SUSPICIOUS_URL'],
        link: 'http://localhost/?scenario=x',
        unhandled: [],
        mismatches: ['GET /api/orders: never sent'],
        suspicious: ['GET http://localhost/users//x: empty path segment (//)'],
        pageErrors: [],
        consoleErrors: [],
        error: null,
        ready: null,
      } satisfies Inspection,
      { screenshot: 's.png', appOrigin: 'http://localhost' },
    );

    expect(page).toContain('- GET /api/orders: never sent');
    expect(page).toContain('- GET http://localhost/users//x: empty path segment (//)');
  });
});
