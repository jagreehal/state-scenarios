import { chromium, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pagePoint } from '../packages/state-scenarios-cli/src/record.ts';

let page: Page;

const browser = await chromium.launch();

beforeAll(async () => {
  page = await browser.newPage();
});

afterAll(() => browser.close());

/** Click the page at (x, y) and return where pagePoint puts the click the iframe saw. */
const clickThrough = async (iframeStyle: string, x: number, y: number) => {
  await page.setContent(
    `<body style="margin:0"><iframe style="position:absolute;left:120px;top:80px;border:3px solid;padding:5px;${iframeStyle}"
      srcdoc="<body style='margin:0;height:300px'></body>"></iframe></body>`,
  );

  const [main, iframe] = page.frames();

  if (!main || !iframe) throw new Error('Expected the page and its iframe');
  await iframe.evaluate(() =>
    addEventListener('pointerdown', (e) => {
      document.body.dataset.x = String(e.clientX);
      document.body.dataset.y = String(e.clientY);
    })
  );

  await page.mouse.click(x, y);

  const body = iframe.locator('body');

  return pagePoint(
    iframe,
    Number(await body.getAttribute('data-x')),
    Number(await body.getAttribute('data-y')),
  );
};

it('leaves clicks in the page where they are', async () => {
  await page.setContent('<p>page</p>');
  const [main] = page.frames();

  if (!main) throw new Error('Expected the page');
  expect(await pagePoint(main, 40, 30)).toEqual({ x: 40, y: 30 });
});

it('places an iframe click in page coordinates, past the iframe border and padding', async () => {
  expect(await clickThrough('', 200, 150)).toEqual({ x: 200, y: 150 });
});

it('places a click in a CSS-scaled iframe where it shows on the page', async () => {
  expect(await clickThrough('transform:scale(2);transform-origin:0 0', 318, 117)).toEqual({ x: 318, y: 117 });
});
