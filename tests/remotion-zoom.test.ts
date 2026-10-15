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

it('moves the point continuously between clicks closer together than the glide', () => {
  const rapid = [{ t: 1000, x: 100, y: 50 }, { t: 1100, x: 300, y: 250 }];

  for (let ms = 900; ms < 1200; ms++) {
    const step = Math.abs(zoomAt(rapid, ms + 1).x - zoomAt(rapid, ms).x);

    expect(step).toBeLessThan(5);
  }

  expect(zoomAt(rapid, 1000).x).toBe(100);
  expect(zoomAt(rapid, 1100).x).toBe(300);
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
