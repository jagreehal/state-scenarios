# remotion-promo

Records three [demo-react](../demo-react) scenarios with `state-scenarios record` and cuts them into a
promo video with [Remotion](https://www.remotion.dev): a title card, then each recording as a card
that zooms to every click, with a caption.

```bash
pnpm --filter demo-react dev   # in another terminal, on http://localhost:5173
pnpm clips                     # record into public/clips: <name>.mp4 and <name>.video.json
pnpm studio                    # preview and edit in Remotion Studio
pnpm render                    # out/promo.mp4
```

- [`steps.ts`](steps.ts) drives each scenario. `server-error` crops to the error message with
  `{ element, steps }`. A short pause before each click gives the zoom time to arrive.
- [`src/Root.tsx`](src/Root.tsx) lists the scenarios and their captions. Its `calculateMetadata`
  reads each `<name>.video.json` and sets the video's length from them.
- [`src/ScenarioClip.tsx`](src/ScenarioClip.tsx) plays one recording, and
  [`src/zoom.ts`](src/zoom.ts) turns its clicks into a camera that zooms in before each click and
  glides between nearby ones.

To use your own app, point `pnpm clips` at your scenarios folder, base URL and steps, then change
the scenario list in `src/Root.tsx`.

Remotion has its own [license](https://www.remotion.dev/license): free for individuals, non-profits and
companies of up to three people; larger companies need a company license.
