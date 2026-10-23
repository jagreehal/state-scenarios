import { expect, it } from 'vitest';
import { zoomAt } from '../examples/remotion-promo/src/zoom.ts';

const clicks = [{ t: 1000, x: 100, y: 50 }, { t: 1600, x: 300, y: 250 }];

it('stays wide with no clicks, and away from them', () => {
  expect(zoomAt([], 500)).toEqual({ scale: 1, x: 0, y: 0 });
  expect(zoomAt(clicks, 0).scale).toBe(1);
  expect(zoomAt(clicks, 5000).scale).toBe(1);
});

it('zooms all the way in on a click and holds it', () => {
  expect(zoomAt(clicks, 1000)).toEqual({ scale: 1.6, x: 100, y: 50 });
  expect(zoomAt(clicks, 2400)).toEqual({ scale: 1.6, x: 300, y: 250 });
});

it('glides between clicks close together instead of jumping', () => {
  expect(zoomAt(clicks, 1400)).toEqual({ scale: 1.6, x: 200, y: 150 });
});

it('moves the point continuously between clicks', () => {
  const near = [{ t: 1000, x: 100, y: 50 }, { t: 1450, x: 300, y: 250 }];

  for (let ms = 900; ms < 1600; ms++) {
    const step = Math.abs(zoomAt(near, ms + 1).x - zoomAt(near, ms).x);

    expect(step).toBeLessThan(5);
  }

  expect(zoomAt(near, 1000).x).toBe(100);
  expect(zoomAt(near, 1450).x).toBe(300);
});

it('makes clicks under 400ms apart one zoom, on the last', () => {
  const double = [{ t: 1000, x: 100, y: 50 }, { t: 1100, x: 105, y: 52 }, { t: 1200, x: 300, y: 250 }];

  expect(zoomAt(double, 1000)).toMatchObject({ x: 300, y: 250 });
  expect(zoomAt(double, 1200)).toEqual({ scale: 1.6, x: 300, y: 250 });
});

it('does not zoom to an element covering most of the page', () => {
  expect(zoomAt([{ t: 1000, x: 100, y: 50, cover: 0.9 }], 1000).scale).toBe(1);
  expect(zoomAt([{ t: 1000, x: 100, y: 50, cover: 0.2 }], 1000).scale).toBe(1.6);
});

it("ends a focused field's hold at a big element's click, though that click gets no zoom", () => {
  const points = [
    { t: 1000, x: 100, y: 50, kind: 'focus' as const },
    { t: 3000, x: 640, y: 360, cover: 0.9 },
    { t: 10_000, x: 900, y: 600 },
  ];

  expect(zoomAt(points, 5000).scale).toBe(1);
});

it('holds on a focused field until the next point, while it is typed into', () => {
  const typing = [{ t: 1000, x: 100, y: 50, kind: 'focus' as const }, { t: 4000, x: 300, y: 250 }];

  expect(zoomAt(typing, 3000)).toEqual({ scale: 1.6, x: 100, y: 50 });
  // A click holds for less than that.
  expect(zoomAt([{ t: 1000, x: 100, y: 50 }, { t: 4000, x: 300, y: 250 }], 3000).scale).toBe(1);
});

it('holds on the last focused field through the end of the clip', () => {
  expect(zoomAt([{ t: 1000, x: 100, y: 50, kind: 'focus' }], 60_000)).toEqual({ scale: 1.6, x: 100, y: 50 });
});
