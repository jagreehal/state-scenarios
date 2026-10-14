// steps.ts: scenario name → what to do once it is ready
import type { Page } from '@playwright/test';

export default {
  'search-no-results': async (page: Page) => {
    await page.getByRole('searchbox').click();
    await page.keyboard.type('Atlantis', { delay: 100 });
  },
  // { element, steps } crops this scenario's video to one component; it overrides --element.
  'cart-empty': {
    element: '.cart',
    steps: async (page: Page) => {
      await page.getByRole('link', { name: 'Browse products' }).hover();
    },
  },
};
