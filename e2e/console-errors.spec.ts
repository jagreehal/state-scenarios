import { expect, test } from '@playwright/test';
import { watchErrors } from '../packages/state-scenarios-cli/src/inspect.ts';

test("counts the app's console errors, not those of a third party's iframe", async ({ page }) => {
  await page.route('http://app.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="http://widget.test/"></iframe><script>console.error('app broke')</script>`,
    }));
  await page.route(
    'http://widget.test/',
    (route) =>
      route.fulfill({ contentType: 'text/html', body: `<script>console.error('widget noise')</script>` }),
  );
  const errors = watchErrors(page);

  await page.goto('http://app.test/');
  await expect.poll(() => page.frames().length).toBe(2);
  await page.waitForLoadState('load');

  expect(errors.consoleErrors).toEqual(['app broke']);
});

test('counts errors from a script the app loads from another origin, such as a CDN', async ({ page }) => {
  await page.route(
    'http://app.test/',
    (route) =>
      route.fulfill({ contentType: 'text/html', body: `<script src="http://cdn.test/app.js"></script>` }),
  );
  await page.route(
    'http://cdn.test/app.js',
    (route) => route.fulfill({ contentType: 'text/javascript', body: `console.error('app broke')` }),
  );
  const errors = watchErrors(page);

  await page.goto('http://app.test/');

  expect(errors.consoleErrors).toEqual(['app broke']);
});

test('leaves out console errors that match ignore, such as a widget warning with no source', async ({ page }) => {
  await page.route('http://app.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>console.error('Refused to apply inline style'); console.error('app broke')</script>`,
    }));
  const errors = watchErrors(page, /inline style/);

  await page.goto('http://app.test/');

  expect(errors.consoleErrors).toEqual(['app broke']);
});
