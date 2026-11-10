// No msw here: the Playwright entry imports this, and msw is optional for it.

/** What one network entry's `expect` has seen so far. */
export interface RequestCheck {
  /** The entry, e.g. "POST /api/orders". */
  entry: string;
  /** Requests the entry answered. */
  sent: number;
  /** One line per answered request that differed from `expect`. */
  mismatches: string[];
}

/** Every mismatch, then every entry with `expect` the app never called. */
export const requestProblems = (checks: RequestCheck[]) => [
  ...checks.flatMap((c) => c.mismatches),
  ...checks.flatMap((c) => (c.sent === 0 ? [`${c.entry}: never sent`] : [])),
];

const BAD_VALUE = /^(undefined|null|NaN|\[object Object\])$/;

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * Why a request URL looks built from a missing or wrong value, or undefined when it looks fine:
 * an empty path segment (`/users//orders`), or a segment or query value that reads `undefined`,
 * `null`, `NaN` or `[object Object]`.
 */
export function suspiciousUrl(href: string): string | undefined {
  const url = new URL(href);

  if (url.pathname.includes('//')) return 'empty path segment (//)';
  const segment = url.pathname.split('/').map(decoded).find((s) => BAD_VALUE.test(s));

  if (segment) return `path segment "${segment}"`;

  for (const [key, value] of url.searchParams) {
    if (BAD_VALUE.test(value)) return `query ${key}=${value}`;
  }

  return undefined;
}
