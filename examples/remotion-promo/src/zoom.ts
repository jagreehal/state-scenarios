/**
 * A point from a `<name>.video.json` manifest: ms into the video and pixels in it. A `focus` is a
 * field taking focus to be typed into; the camera holds on it until the next point. `cover` is the
 * share of the picture (0 to 1) its element covers.
 */
export interface Click {
  t: number;
  x: number;
  y: number;
  kind?: 'focus';
  cover?: number;
}

const LEAD = 400;

const HOLD = 900;

const OUT = 600;

/** Points closer than this are one gesture (a double-click, a click then the field it focuses). */
const MERGE = 400;

/** An element covering more of the picture than this (a card grid, the page body) is not worth zooming to. */
const BIG = 0.6;

const ease = (p: number) => p * p * (3 - 2 * p);

const clamp = (p: number) => Math.min(1, Math.max(0, p));

/** 0 to 1: zooming in before a click, held after it for `hold` ms, then zooming out. */
const level = (ms: number, hold: number) =>
  ms < 0 ? ease(clamp(1 + ms / LEAD)) : ease(clamp(1 - (ms - hold) / OUT));

/**
 * A click holds briefly; a focused field holds while it is typed into, until the next point of any
 * kind (a big element's click included, though it gets no zoom) or, for the last one, the end of the clip.
 */
const holdFor = (all: Click[], c: Click) => {
  if (c.kind !== 'focus') return HOLD;

  const next = all.find((p) => p.t > c.t);

  return next ? Math.max(HOLD, next.t - c.t) : Infinity;
};

/** The points worth zooming to: the last of each run closer than `MERGE` (where the eye ends up), unless its element is big. */
const targets = (clicks: Click[]) =>
  clicks
    .filter((c, i) => !(clicks[i + 1] && clicks[i + 1].t - c.t < MERGE))
    .filter((c) => !(c.cover !== undefined && c.cover > BIG));

/**
 * The camera at `ms`: how far it zooms in and the point it zooms to. Between clicks close enough
 * to overlap, the point glides from one to the next instead of jumping. Points closer than 400ms
 * are one zoom, on the last of them; an element covering over 60% of the picture gets none.
 */
export function zoomAt(all: Click[], ms: number, peak = 1.6) {
  const clicks = targets(all);
  const strength = Math.max(0, ...clicks.map((c) => level(ms - c.t, holdFor(all, c))));
  const next = clicks.findIndex((c) => c.t >= ms);
  const to = clicks[next === -1 ? clicks.length - 1 : next];
  const from = clicks[next - 1] ?? to;

  if (!to || !from) return { scale: 1, x: 0, y: 0 };

  // Starts at the previous click when they are closer than LEAD, so the point never jumps.
  const glideStart = Math.max(from.t, to.t - LEAD);
  const glide = to.t > glideStart ? ease(clamp((ms - glideStart) / (to.t - glideStart))) : 1;

  return {
    scale: 1 + (peak - 1) * strength,
    x: from.x + (to.x - from.x) * glide,
    y: from.y + (to.y - from.y) * glide,
  };
}
