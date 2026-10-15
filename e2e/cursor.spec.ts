import { expect, type Page, test } from '@playwright/test';
import { glideBeforeActions, showCursor } from 'state-scenarios/playwright';

// Pages served from a stand-in origin, so these need none of the example apps.
const pages = {
  '/frames':
    `<body style="margin:0"><iframe src="/inner" style="position:absolute;left:300px;top:200px;width:400px;height:300px;border:5px solid"></iframe></body>`,
  '/inner': `<body><button id=b style="margin:50px">inner</button><iframe src="/nested"></iframe></body>`,
  '/nested': `<body><button id=c>nested</button></body>`,
  '/scaled':
    `<body style="margin:0"><iframe src="/inner" style="position:absolute;left:100px;top:50px;width:400px;height:300px;border:5px solid;padding:20px;transform:scale(.5);transform-origin:0 0"></iframe></body>`,
  '/field':
    `<body style="margin:0"><input id=t style="position:absolute;left:20px;top:20px;width:200px"></body>`,
  // Below the fold, so typing would scroll it away from where the cursor went.
  '/below':
    `<body style="margin:0;height:3000px"><input id=t style="position:absolute;left:20px;top:2000px;width:200px"></body>`,
  // Moves, or widens, just after the cursor reaches it.
  '/move':
    `<body style="margin:0"><button id=t style="position:absolute;left:20px;top:100px;width:50px">t</button><script>t.addEventListener('mouseenter',()=>setTimeout(()=>t.style.left='500px',100),{once:true})</script></body>`,
  '/grow':
    `<body style="margin:0"><button id=t style="position:absolute;left:20px;top:100px;width:50px">t</button><script>t.addEventListener('mouseenter',()=>setTimeout(()=>t.style.width='500px',100),{once:true})</script></body>`,
} satisfies Record<string, string>;

test.beforeEach(async ({ page }) => {
  await page.route(
    'http://cursor.test/**',
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: Object.entries(pages).find(([path]) => path === new URL(route.request().url()).pathname)?.[1],
      }),
  );
  await showCursor(page);
});

/** Where each drawn cursor sits, across every frame. */
const drawn = (page: Page) =>
  Promise.all(
    page.frames().map((frame) =>
      frame.evaluate(() =>
        [...document.querySelectorAll('.ss-cursor')].map((c) => {
          const { e, f } = new DOMMatrix(getComputedStyle(c).transform);

          return { x: e, y: f };
        })
      )
    ),
  ).then((all) => all.flat());

/** Hover, let the glide finish, and expect one cursor at the target's centre. */
const expectCursorOn = async (page: Page, frame: number, selector: string) => {
  const box = await page.frames()[frame].locator(selector).boundingBox();

  if (!box) throw new Error(`${selector} isn't visible`);

  // Playwright moves the mouse to whole pixels, so allow one.
  await expect.poll(async () => {
    const cursors = await drawn(page);

    return cursors.map((c) =>
      Math.max(Math.abs(c.x - (box.x + box.width / 2)), Math.abs(c.y - (box.y + box.height / 2))) <= 1
    );
  }).toEqual([true]);
};

test('draws one cursor, in the top frame, over targets in nested iframes', async ({ page }) => {
  await page.goto('http://cursor.test/frames');
  await expect.poll(() => drawn(page).then((c) => c.length)).toBe(1);

  await page.frameLocator('iframe').locator('#b').hover();
  await expectCursorOn(page, 1, '#b');

  await page.frameLocator('iframe').frameLocator('iframe').locator('#c').hover();
  await expectCursorOn(page, 2, '#c');
});

test('maps through an iframe’s CSS scale, border and padding', async ({ page }) => {
  await page.goto('http://cursor.test/scaled');
  await page.frameLocator('iframe').locator('#b').hover();
  await expectCursorOn(page, 1, '#b');
});

for (const path of ['/move', '/grow']) {
  test(`record glides again when the target changes during the glide (${path})`, async ({ page }) => {
    glideBeforeActions(page);
    await page.goto(`http://cursor.test${path}`);

    const at = page.evaluate(() =>
      new Promise<{ click: number; cursor: number; }>((resolve) =>
        addEventListener('mousedown', (e) => {
          const cursor = new DOMMatrix(getComputedStyle(document.querySelector('.ss-cursor')!).transform).e;
          resolve({ click: e.clientX, cursor });
        }, { once: true, capture: true })
      )
    );

    await page.locator('#t').click();
    const { click, cursor } = await at;
    expect(cursor).toBeCloseTo(click, 0);
  });
}

test('typing waits for the cursor to reach the field', async ({ page }) => {
  glideBeforeActions(page);
  await page.goto('http://cursor.test/field');
  const box = (await page.locator('#t').boundingBox())!;

  // Where the cursor is drawn when the first character goes in.
  const at = page.evaluate(() =>
    new Promise<number>((resolve) =>
      addEventListener('input', () => {
        resolve(new DOMMatrix(getComputedStyle(document.querySelector('.ss-cursor')!).transform).e);
      }, { once: true, capture: true })
    )
  );

  await page.locator('#t').fill('Lena');
  expect(await at).toBeCloseTo(box.x + 24, 0);
});

test('size scales the pointer and halo: false drops the halo', async ({ page }) => {
  await showCursor(page, { size: 2, halo: false });
  await page.goto('http://cursor.test/field');

  // beforeEach drew a default cursor too; the last one is this test's.
  const last = page.locator('.ss-cursor').last();
  expect(await last.evaluate((c) => getComputedStyle(c, '::before').display)).toBe('none');
  expect((await last.locator('svg').boundingBox())?.width).toBeCloseTo(64, 0);
});

test('scrolls an offscreen field into view before gliding to it', async ({ page }) => {
  glideBeforeActions(page);
  await page.goto('http://cursor.test/below');

  const at = page.evaluate(() =>
    new Promise<{ cursor: { x: number; y: number; }; field: DOMRect; }>((resolve) =>
      addEventListener('input', () => {
        const { e, f } = new DOMMatrix(getComputedStyle(document.querySelector('.ss-cursor')!).transform);
        resolve({ cursor: { x: e, y: f }, field: document.querySelector('#t')!.getBoundingClientRect() });
      }, { once: true, capture: true })
    )
  );

  await page.locator('#t').fill('Lena');
  const { cursor, field } = await at;
  // Playwright moves the mouse to whole pixels, so allow one.
  expect(Math.abs(cursor.x - (field.x + 24))).toBeLessThanOrEqual(1);
  expect(Math.abs(cursor.y - (field.y + field.height / 2))).toBeLessThanOrEqual(1);
});
