import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stateScenarios } from '../packages/state-scenarios/src/vite.ts';

/** The part of a service worker fetch event the worker's first listener reads. */
interface WorkerFetch {
  request: { url: string; destination: string; };
  stopImmediatePropagation: () => void;
}

// An app with no state-scenarios code and no msw of its own; the plugin brings both.
describe('state-scenarios/vite inject', () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-inject-'));
  const dir = join(root, 'e2e-scenarios');
  let server: ViteDevServer;

  beforeAll(async () => {
    mkdirSync(dir);
    mkdirSync(join(root, 'src'));

    for (const entry of ['main.tsx', 'b.ts', 'c.ts', 'd.ts']) {
      writeFileSync(join(root, 'src', entry), 'export {};');
    }

    writeFileSync(join(root, 'src/mocks.ts'), 'export const handlers = [];');
    mkdirSync(join(root, 'src/more'));
    writeFileSync(join(root, 'src/more/a.ts'), 'export default [];');
    writeFileSync(
      join(dir, 'signed-in.json'),
      JSON.stringify({ name: 'signed-in', state: { cookies: { t: '1' } } }),
    );
    writeFileSync(join(dir, 'scenario.schema.json'), '{}');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, ws: false },
      plugins: [
        stateScenarios({
          dir,
          inject: {
            handlers: ['/src/mocks.ts', '/src/more/*.ts'],
            defaultScenario: 'signed-in',
            ignore: ['posthog', /^https:\/\/stripe/i],
          },
        }),
      ],
    });
    await server.listen();
  });

  afterAll(() => server.close());

  it("starts scenarios before the app's entry, and leaves Vite's client alone", async () => {
    const html = await server.transformIndexHtml(
      '/',
      '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>',
    );

    // Vite serves the inline entry as a module of its own; fetch what the browser runs.
    const entry = /src="([^"]*html-proxy[^"]*)"/.exec(html)?.[1];
    const res = await fetch(new URL(entry ?? '/missing', server.resolvedUrls!.local[0]));
    const code = await res.text();

    expect(html).not.toContain('src="/src/main.tsx"');
    expect(code.indexOf('virtual:state-scenarios/start')).toBeGreaterThan(-1);
    expect(code.indexOf('virtual:state-scenarios/start')).toBeLessThan(code.indexOf('/src/main.tsx'));
    expect(html).toContain('<script type="module" src="/@vite/client"></script>');
  });

  it('wraps module entries whatever their attribute order and quoting', async () => {
    const html = await server.transformIndexHtml(
      '/',
      `<html><head></head><body>
        <script type="module" crossorigin src="/src/main.tsx"></script>
        <script src='/src/b.ts' type='module'></script>
        <script type=module src=/src/c.ts></script>
        <script src="/src/d.ts"></script>
      </body></html>`,
    );

    // Vite moves each inline script into a module of its own; each one starts scenarios first.
    const proxies = [...html.matchAll(/src="([^"]*html-proxy[^"]*)"/g)].map((m) => m[1] ?? '');

    const codes = await Promise.all(
      proxies.map(async (p) => (await fetch(new URL(p, server.resolvedUrls!.local[0]))).text()),
    );

    expect(codes).toHaveLength(3);

    for (const [code, entry] of codes.map((c, i) => [c, ['main.tsx', 'b.ts', 'c.ts'][i]] as const)) {
      expect(code.indexOf('virtual:state-scenarios/start')).toBeGreaterThan(-1);
      expect(code.indexOf('virtual:state-scenarios/start')).toBeLessThan(code.indexOf(`/src/${entry}`));
    }

    // A classic script isn't an app entry the runtime must precede.
    expect(html).toContain('<script src="/src/d.ts"></script>');
  });

  it('loads every scenario in dir, layers the handlers modules beneath, and mounts the panel', async () => {
    const id = await server.pluginContainer.resolveId('virtual:state-scenarios/start');
    const loaded = await server.pluginContainer.load(id!.id);
    const code = z.string().parse(loaded);

    expect(code).toContain('import * as module0 from "/src/mocks.ts";');
    expect(code).toContain(
      'const handlers1 = Object.values(import.meta.glob("/src/more/*.ts", { eager: true }));',
    );
    // Base layer from each module's handlers or default export; every named export by name.
    expect(code).toContain(
      'setupWorker(code, ...[...handlers0, ...handlers1].flatMap((m) => m.handlers ?? m.default ?? []))',
    );
    expect(code).toContain('handlers: namedHandlers(...handlers0, ...handlers1),');
    expect(code).toContain(
      '"scenarios":[{"name":"signed-in","state":{"cookies":{"t":"1"}}}],"defaultScenario":"signed-in"',
    );
    expect(code).toContain('ignore: ["posthog", new RegExp("^https:\\\\/\\\\/stripe", "i")],');
    expect(code).toContain(
      "adapters: [cookiesAdapter(), storageAdapter(), storageAdapter({ area: 'session' })],",
    );
    expect(code).toContain('mountPanel(session);');
  });

  it("serves MSW's worker script, from this package when the app has no msw", async () => {
    const res = await fetch(new URL('/mockServiceWorker.js', server.resolvedUrls!.local[0]));

    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(await res.text()).toContain('Mock Service Worker');
  });

  it('lets code, styles, fonts and frames past MSW in the worker, and API calls through to it', async () => {
    const script = await (await fetch(new URL('/mockServiceWorker.js', server.resolvedUrls!.local[0])))
      .text();

    // Run the lines ahead of MSW's own with a stand-in `self`, then send it fetch events.
    const prefix = script.slice(0, script.indexOf('/* eslint-disable */'));
    const listeners: ((event: WorkerFetch) => void)[] = [];
    runInNewContext(prefix, {
      URL,
      self: {
        addEventListener: (_type: string, listener: (event: WorkerFetch) => void) => listeners.push(listener),
      },
    });

    const passes = (url: string, destination = '') => {
      let stopped = false;

      for (const listener of listeners) {
        listener({ request: { url, destination }, stopImmediatePropagation: () => (stopped = true) });
      }

      return stopped;
    };

    expect(passes('http://localhost/src/main.tsx')).toBe(true);
    expect(passes('https://fonts.example/css2?family=Inter', 'style')).toBe(true);
    expect(passes('https://chat.example/', 'iframe')).toBe(true);
    expect(passes('http://api.invalid/orders')).toBe(false);
    expect(passes('http://localhost/logo.png', 'image')).toBe(false);
  });
});

describe('state-scenarios/vite inject into a build', () => {
  const app = (name: string) => {
    const root = mkdtempSync(join(tmpdir(), `ss-${name}-`));
    mkdirSync(join(root, 'scenarios'));
    writeFileSync(join(root, 'scenarios/demo.json'), JSON.stringify({ name: 'demo-from-build' }));
    writeFileSync(
      join(root, 'index.html'),
      '<html><body><script type="module" src="/main.js"></script></body></html>',
    );
    writeFileSync(join(root, 'main.js'), 'document.body.dataset.app = "1";');

    return root;
  };

  const run = (root: string, injectBuild: boolean) =>
    build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [stateScenarios({ dir: 'scenarios', inject: { build: injectBuild } })],
    });

  const bundled = (root: string) =>
    readdirSync(join(root, 'dist/assets')).map((f) => readFileSync(join(root, 'dist/assets', f), 'utf8'))
      .join('\n');

  it('ships the scenarios, runtime and worker script only when asked', async () => {
    const on = app('build-on');
    await run(on, true);

    expect(existsSync(join(on, 'dist/mockServiceWorker.js'))).toBe(true);
    expect(bundled(on)).toContain('demo-from-build');

    const off = app('build-off');
    await run(off, false);

    expect(existsSync(join(off, 'dist/mockServiceWorker.js'))).toBe(false);
    expect(bundled(off)).not.toContain('demo-from-build');
  }, 60_000);
});
