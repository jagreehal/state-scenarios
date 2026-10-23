import { expect, test } from '@playwright/test';
import { http, HttpResponse, passthrough } from 'msw';
import { createServer } from 'node:http';
import { openScenario, routeScenario } from 'state-scenarios/playwright';
import { z } from 'zod';

// An app that runs no state-scenarios code: it reads a cookie and calls an API on another origin.
const APP = `<!doctype html><body><pre id="out"></pre><script type="module">
  const statuses = await Promise.all(['/orders', '/me', '/missing'].map(async (p) => (await fetch('http://api.test' + p)).status));
  const orders = await (await fetch('http://api.test/orders')).json();
  // With credentials, as a cookie-session API needs: '*' won't do, so the origin is echoed.
  const me = await (await fetch('http://api.test/me', { credentials: 'include' })).json();
  document.getElementById('out').textContent = JSON.stringify({
    orders, statuses, me, cookie: document.cookie,
    theme: localStorage.getItem('theme'), auth: localStorage.getItem('auth'), year: new Date().getFullYear(),
  });
</script></body>`;

test('routeScenario sets up a scenario for an app with no runtime: fixtures, named handlers, storage, clock', async ({ page }) => {
  await page.route('http://app.test/', (route) => route.fulfill({ contentType: 'text/html', body: APP }));

  const api = await routeScenario(page, {
    url: 'http://api.test/**',
    scenario: 'orders-empty',
    scenarios: [
      {
        name: 'signed-in',
        now: '2031-03-31T09:00:00Z',
        state: { cookies: { session: 'e2e' }, localStorage: { theme: 'dark', auth: { token: 'e2e' } } },
      },
      {
        name: 'orders-empty',
        extends: 'signed-in',
        network: [{ path: '*/orders', response: { body: [] } }],
        handlers: ['meReadOnly'],
      },
    ],
    handlers: [
      http.get('*/orders', () => HttpResponse.json([{ id: 1 }])),
      http.get('*/me', () => HttpResponse.json({ name: 'Alex' })),
    ],
    named: { meReadOnly: http.get('*/me', () => HttpResponse.json({ name: 'Alex', readOnly: true })) },
  });

  await page.goto('http://app.test/');
  const out = page.locator('#out');
  await expect(out).not.toBeEmpty();
  const shown = JSON.parse(await out.textContent() ?? '{}');

  expect(shown).toEqual({
    orders: [],
    statuses: [200, 200, 501],
    me: { name: 'Alex', readOnly: true },
    cookie: 'session=e2e',
    theme: 'dark',
    auth: '{"token":"e2e"}',
    year: 2031,
  });
  expect(api.unhandled).toEqual(['GET /missing']);

  api.use(http.get('*/orders', () => HttpResponse.json([{ id: 2 }])));
  await page.reload();
  await expect(out).toContainText('"orders":[{"id":2}]');
});

test('routeScenario hands handlers the cookies the browser sends, for cookie sessions', async ({ page, context }) => {
  // Same site as the app, so the browser sends the API's cookie on a credentialed fetch.
  await context.addCookies([{ name: 'sid', value: 'abc', url: 'http://api.app.test' }]);
  await page.route('http://app.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<pre id="out"></pre><script type="module">
        const res = await fetch('http://api.app.test/session', { credentials: 'include' });
        document.getElementById('out').textContent = await res.text();
      </script>`,
    }));

  await routeScenario(page, {
    url: 'http://api.app.test/**',
    handlers: [
      http.get('*/session', ({ request }) => HttpResponse.text(request.headers.get('cookie') ?? 'none')),
    ],
  });

  await page.goto('http://app.test/');
  await expect(page.locator('#out')).toHaveText('sid=abc');
});

test('openScenario waits for steps, not a ready element the steps take away', async ({ page }) => {
  // Marks itself as the runtime does: steps running, then done after removing the ready element.
  await page.route(/\/steps-fixture\?/, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html data-scenario="with-steps" data-scenario-ready="#list" data-scenario-steps="running">
        <body><ul id="list"><li>row</li></ul><script>
          // The steps have already taken the ready element away when Playwright first looks.
          document.getElementById('list').remove();
          setTimeout(() => (document.documentElement.dataset.scenarioSteps = 'done'), 300);
        </script></body></html>`,
    }));

  await openScenario(page, 'with-steps', { path: '/steps-fixture', panel: false });

  await expect(page.locator('html')).toHaveAttribute('data-scenario-steps', 'done');
  await expect(page.locator('#list')).toHaveCount(0);
});

test('routeScenario fails a request on HttpResponse.error() and sends passthrough() to the real server', async ({ page }) => {
  // A real server for the app and its API, so a passed-through request has to leave the browser
  // to be answered. Same origin: Chrome blocks a public page from fetching a loopback address.
  const app = `<pre id="out"></pre><script type="module">
    const down = await fetch('/api/down').then(() => 'answered', () => 'failed');
    const real = await (await fetch('/api/real')).text();
    document.getElementById('out').textContent = down + ' ' + real;
  </script>`;

  const server = createServer((req, res) => {
    if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html' }).end(app);
    else res.writeHead(200).end('from server');
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  const base = `http://127.0.0.1:${port}`;

  await routeScenario(page, {
    url: `${base}/api/**`,
    handlers: [
      http.get('*/api/down', () => HttpResponse.error()),
      http.get('*/api/real', () => passthrough()),
    ],
  });

  try {
    await page.goto(base);
    await expect(page.locator('#out')).toHaveText('failed from server');
  } finally {
    server.close();
  }
});
