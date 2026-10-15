# Screenshots and videos for docs and websites

## Screenshots

```bash
npx state-scenarios shoot src/scenarios --base-url http://localhost:5173 --out shots \
  --no-panel --viewport 1440x900 --scale 2 --color-scheme dark --element main
```

- `--no-panel` hides the dev panel. `--scale 2` gives sharp images on high-density screens.
- `--element <selector>` captures one component instead of the full page.
- A scenario's `viewport` overrides `--viewport`, so phone and desktop layouts shoot in one run.
- `--locale` (BCP 47: `en-GB`, `de-DE`, `ar-EG`, `hi-IN`, `ja-JP`, `pt-BR`) and `--timezone` (IANA:
  `Europe/Berlin`, `Asia/Kolkata`, `America/Sao_Paulo`) set what `Intl`, `Date` and
  `navigator.language` report. Set both, or shots change with each machine's settings. Run once
  per market to show dates, numbers, currencies and right-to-left layouts as people there see them.

## Videos

```ts
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
```

```bash
npx state-scenarios record src/scenarios --base-url http://localhost:5173 --steps steps.ts --format mp4
```

- The panel is hidden and a bright arrow cursor is drawn (Playwright videos don't show the mouse).
  It pulses, glides to each target before `locator.click()` lands, and sends out a ripple on the
  click. `--cursor-color <css>` (default `#ff2d55`) recolours it; `--cursor <file.svg>` draws your
  own, with its top-left corner at the mouse.
- The video starts once the scenario is ready and holds the last frame for `--hold` ms (default
  800), so there's no need for a `waitForTimeout` at the end of steps. Uncropped
  `--format webm` is the exception: it keeps the page load, and needs no ffmpeg.
- `--format mp4` (default) plays in every browser and phone at a fraction of a GIF's size; use it
  on websites. `--format gif` for READMEs and other image-only places. `--element` crops: the
  element is scrolled into view first, and one larger than the viewport is cut to the visible part
  (use a larger `--viewport`). Steps that scroll the page move the element out of the crop.
- For website GIFs, `--width 900` caps the width and `--fps 10` lowers the frame rate (GIFs default to
  12); both cut file size.
- Video records at viewport size, so use a larger `--viewport` for sharper video; `--scale`
  affects screenshots only.
- MP4, GIF, `--element`, `--fps` and `--width` need ffmpeg on `PATH`, or `FFMPEG_PATH`. WebM without them doesn't.
- Each video gets a `<name>.video.json` manifest: size, length, description and clicks. See
  [Videos in Remotion](#videos-in-remotion).
- In your own Playwright scripts, `showCursor(page, { color, svg })` from `state-scenarios/playwright`
  draws the cursor; call it before `openScenario(page, name, { panel: false })`. Hover before a
  click there, so the cursor arrives first.

## Videos in Remotion

`record` writes `<name>.video.json` next to each video, for editors such as
[Remotion](https://www.remotion.dev):

```json
{
  "name": "default",
  "description": "All 248 countries from the API",
  "video": "default.mp4",
  "width": 1280,
  "height": 720,
  "durationMs": 4185,
  "clicks": [{ "t": 731, "x": 93, "y": 56 }]
}
```

`durationMs` and click times count from the first frame of the saved video. Click `x` and `y` are
pixels in it, after `--element` and `--width`. Record into the Remotion project's `public/` folder,
then:

- Read the manifests in the composition's `calculateMetadata` to set `durationInFrames`.
- Play each video with `<Video src={staticFile(...)} />` from `@remotion/media`.
- Zoom to each click by scaling the video around its `x` and `y` shortly before `t`.
- Use `description` as a caption, or replace it per scenario.

Pace steps with a short `page.waitForTimeout` before each click, so the zoom has time to arrive.
`examples/remotion-promo` in the state-scenarios repo does all of this.

Use demo data in scenarios meant for public images: fictional names, no real customer records.
