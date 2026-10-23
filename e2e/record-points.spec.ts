import { expect, test } from '@playwright/test';
import { reportPoints } from '../packages/state-scenarios-cli/src/record.ts';

// Like a combobox's search: focused while parked above the page, positioned a frame later.
const popup =
  `<body style="margin:0"><div id=menu hidden style="position:fixed;left:20px;top:0;transform:translate(0,-200%)">`
  + `<input id=t style="width:200px;height:20px;margin:0;border:0;padding:0"></div>`
  + `<script>setTimeout(() => { menu.hidden = false; t.focus(); requestAnimationFrame(() => menu.style.transform = 'translate(0,100px)'); }, 100)</script></body>`;

test("record notes where a popup's focused field lands, not where it was parked", async ({ page }) => {
  const points: { x: number; y: number; kind?: string; }[] = [];
  await page.exposeBinding(
    'stateScenariosClick',
    (_, x: number, y: number, kind?: string) => points.push({ x, y, kind }),
  );
  await page.addInitScript(reportPoints);
  await page.route(
    'http://record.test/**',
    (route) => route.fulfill({ contentType: 'text/html', body: popup }),
  );
  await page.goto('http://record.test/');

  await expect.poll(() => points).toEqual([{ x: 44, y: 110, kind: 'focus' }]);
});
