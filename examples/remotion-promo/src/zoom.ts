/**
 * A point from a `<name>.video.json` manifest: ms into the video and pixels in it. A `focus` is a
 * field taking focus to be typed into; the camera holds on it until the next point.
 */
export interface Click {
  t: number;
  x: number;
  y: number;
  kind?: 'focus';
}

const LEAD = 400;

const HOLD = 900;

const OUT = 600;

const ease = (p: number) => p * p * (3 - 2 * p);

const clamp = (p: number) => Math.min(1, Math.max(0, p));

/** 0 to 1: zooming in before a click, held after it for `hold` ms, then zooming out. */
const level = (ms: number, hold: number) =>
  ms < 0 ? ease(clamp(1 + ms / LEAD)) : ease(clamp(1 - (ms - hold) / OUT));

/**
 * A click holds briefly; a focused field holds while it is typed into, until the next point or,
 * for the last one, the end of the clip.
 */
const holdFor = (clicks: Click[], i: number) => {
  if (clicks[i]?.kind !== 'focus') return HOLD;

  const next = clicks[i + 1];

  return next ? Math.max(HOLD, next.t - clicks[i].t) : Infinity;
};

/**
 * The camera at `ms`: how far it zooms in and the point it zooms to. Between clicks close enough
 * to overlap, the point glides from one to the next instead of jumping.
 */
export function zoomAt(clicks: Click[], ms: number, peak = 1.6) {
  const strength = Math.max(0, ...clicks.map((c, i) => level(ms - c.t, holdFor(clicks, i))));
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
