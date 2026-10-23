import { expect, type Page, test } from '@playwright/test';
import { watchErrors } from '../packages/state-scenarios-cli/src/inspect.ts';

const serve = (page: Page, url: string, body: string, headers: Record<string, string> = {}) =>
  page.route(
    url,
    (route) =>
      route.fulfill({ contentType: url.endsWith('.js') ? 'text/javascript' : 'text/html', body, headers }),
  );

test("counts the app's errors, whatever origin its scripts load from, not another site's iframe", async ({ page }) => {
  // The app embeds an iframe on vendor.test, then loads a script from vendor.test too.
  await serve(
    page,
    'http://app.test/',
    `<iframe src="http://vendor.test/frame"></iframe>
     <iframe src="http://app.test/inner"></iframe>
     <script>addEventListener('load', () => document.head.append(Object.assign(document.createElement('script'), { src: 'http://vendor.test/sdk.js' })))</script>`,
  );
  await serve(page, 'http://vendor.test/sdk.js', `console.error('sdk in the app broke')`);
  await serve(page, 'http://vendor.test/frame', `<script>console.error('vendor frame noise')</script>`);
  await serve(page, 'http://app.test/inner', `<script>console.error('app iframe broke')</script>`);
  const errors = await watchErrors(page);

  await page.goto('http://app.test/');
  await expect.poll(() => errors.consoleErrors.length).toBe(2);
  await page.waitForTimeout(200);

  expect(errors.consoleErrors.toSorted()).toEqual(['app iframe broke', 'sdk in the app broke']);
});

test("leaves out an iframe's errors from scripts on yet another origin, and its CSP warnings", async ({ page }) => {
  await serve(
    page,
    'http://app.test/',
    `<iframe src="http://widget.test/"></iframe><script>console.error('app broke')</script>`,
  );
  await serve(
    page,
    'http://widget.test/',
    `<div style="color: red">styled</div><script src="http://cdn.test/widget.js"></script>`,
    { 'content-security-policy': "style-src 'self'; script-src http://cdn.test" },
  );
  await serve(page, 'http://cdn.test/widget.js', `console.error('widget noise')`);
  const errors = await watchErrors(page);

  await page.goto('http://app.test/');
  await expect.poll(() => page.frames()[1]?.evaluate(() => document.readyState)).toBe('complete');
  await page.waitForTimeout(200);

  expect(errors.consoleErrors).toEqual(['app broke']);
});

test('leaves out console errors that match ignore', async ({ page }) => {
  await serve(
    page,
    'http://app.test/',
    `<script>console.error('Refused to apply inline style'); console.error('app broke')</script>`,
  );
  const errors = await watchErrors(page, /inline style/);

  await page.goto('http://app.test/');

  expect(errors.consoleErrors).toEqual(['app broke']);
});
