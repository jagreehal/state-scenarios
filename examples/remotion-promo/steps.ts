// Steps for `pnpm clips`: what each demo-react scenario does on camera. The pauses give viewers,
// and the zoom in the Remotion composition, time to follow each click.
import type { Page } from '@playwright/test';

const beat = (page: Page) => page.waitForTimeout(700);

export default {
  default: async (page: Page) => {
    await beat(page);
    await page.getByRole('button', { name: /Filters/ }).click();
    await beat(page);
    await page.getByLabel('Europe').click();
    await beat(page);
    await page.getByLabel('French').click();
  },
  'twenty-one-countries': async (page: Page) => {
    await beat(page);
    await page.getByRole('button', { name: '1', exact: true }).click();
    await beat(page);
    await page.getByRole('button', { name: '2', exact: true }).click();
  },
  // Cropped to the error message, so the Retry click fills the frame.
  'server-error': {
    element: '[role=alert]',
    steps: async (page: Page) => {
      await beat(page);
      await page.getByRole('button', { name: 'Retry' }).click();
    },
  },
};
