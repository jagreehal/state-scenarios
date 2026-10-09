import { expect, test } from '@playwright/test';
import { openScenario } from 'state-scenarios/playwright';

// Next.js App Router: the session runs in the browser, after hydration.
test.use({ baseURL: 'http://localhost:5181' });

test('without a scenario the app hits the real API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Hello from the real API')).toBeVisible();
});

test('a scenario mocks client fetches and sets URL params Next can read', async ({ page }) => {
  // Not strict: Next dev makes its own requests (HMR, RSC).
  await openScenario(page, 'greeting-error', { strict: false });
  await expect(page.getByText('Greeting service down')).toBeVisible();
  await expect(page.getByText('Name from URL: Ada')).toBeVisible();
});

test('scenario cookies reach server components on the next request', async ({ page }) => {
  await openScenario(page, 'admin', { strict: false });
  await expect(page.getByText('Server sees role: guest')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Server sees role: admin')).toBeVisible();
});
