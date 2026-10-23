import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateScenarios } from 'state-scenarios/vite';
import { createServer, type ViteDevServer } from 'vite';

// An app that starts on DOMContentLoaded and load, as many do, and runs no state-scenarios code.
let server: ViteDevServer;

test.beforeAll(async () => {
  // The real path: Vite refuses files reached through a symlinked temp folder.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ss-inject-e2e-')));
  mkdirSync(join(root, 'scenarios'));
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><html><body><pre id="out"></pre>
      <script>window.seen = []; document.addEventListener('DOMContentLoaded', () => seen.push('early'));</script>
      <script type="module" src="/main.js"></script></body></html>`,
  );
  writeFileSync(
    join(root, 'main.js'),
    `document.addEventListener('DOMContentLoaded', () => seen.push('ready'));
     addEventListener('load', () => {
       seen.push('load');
       document.getElementById('out').textContent = seen.join(' ');
     });`,
  );
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { port: 0 },
    plugins: [stateScenarios({ dir: join(root, 'scenarios'), inject: { panel: false } })],
  });
  await server.listen();
});

test.afterAll(() => server.close());

test('an injected app still gets DOMContentLoaded and load, each once, after its entry runs', async ({ page }) => {
  await page.goto(server.resolvedUrls!.local[0]);

  await expect(page.locator('#out')).toHaveText('early ready load');
});
