import { describe, expect, it } from 'vitest';
import { buildComment, MARKER } from '../actions/pr-screenshots/comment.mjs';

const shot = (
  name: string,
  compare?: { status: 'same' | 'changed' | 'new'; ratio: number; image: string | null; },
) => ({
  name,
  ok: true,
  codes: [],
  error: null,
  screenshot: `/tmp/after/${name}.png`,
  compare,
});

describe('the pr-screenshots comment', () => {
  it('shows changed and new states with their images and reasons, and folds the rest', () => {
    const body = buildComment({
      shots: [
        shot('orders-error', { status: 'changed', ratio: 0.0123, image: '/tmp/after/orders-error.diff.png' }),
        shot('orders-new', { status: 'new', ratio: 1, image: null }),
        shot('orders-empty', { status: 'same', ratio: 0, image: null }),
        { ...shot('orders-slow'), ok: false, codes: ['READY_TIMEOUT'], error: 'never ready' },
      ],
      affected: [{
        name: 'orders-error',
        reasons: [{ kind: 'endpoint', detail: 'src/api.ts calls /api/orders' }],
      }],
      unmatched: ['src/theme.css'],
      all: true,
      links: { 'orders-error.diff.png': 'https://x/e.png', 'orders-new.png': 'https://x/n.png' },
      sha: 'abcdef1234',
    });

    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain(
      '**1** changed · **1** new · **1** unchanged · **1** failing · at abcdef1 · every state shot',
    );
    expect(body).toContain(
      '#### `orders-error` · changed (1.2% of pixels)\n<sub>endpoint: src/api.ts calls /api/orders</sub>',
    );
    expect(body).toContain('![orders-error](https://x/e.png)');
    expect(body).toContain('![orders-new](https://x/n.png)');
    expect(body).toContain('- `orders-slow`: READY_TIMEOUT: never ready');
    expect(body).toContain('<summary>Unchanged (1)</summary>');
    expect(body).toContain('every state was shot');
  });

  it('says so when nothing is affected, and when images went unpublished', () => {
    expect(buildComment({ shots: [], affected: [], unmatched: [], all: false, links: {}, sha: 'abc1234' }))
      .toContain('No UI state is affected by this change.');

    const fork = buildComment({
      shots: [shot('a', { status: 'new', ratio: 1, image: null })],
      affected: [],
      unmatched: [],
      all: false,
      links: {},
      sha: 'abc1234',
      note: 'from a fork',
    });

    expect(fork).toContain('> from a fork');
    expect(fork).toContain('_Image not published._');
  });
});
