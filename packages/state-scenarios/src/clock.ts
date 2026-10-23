/**
 * Make `Date` start at `iso` and run on from there: `new Date()` and `Date.now()` move, a date
 * built from arguments doesn't. Self-contained, so Playwright can pass it to `addInitScript`.
 * Returns a function that puts the real `Date` back.
 */
export function installClock(iso: string): () => void {
  const Real = globalThis.Date;
  const offset = Real.parse(iso) - Real.now();
  const now = () => Real.now() + offset;

  // Statics (parse, UTC) come from the real Date through the prototype chain, apart from now;
  // instances are real Dates, so `instanceof Date` holds either way.
  const stand = Object.setPrototypeOf(Object.assign(function Date() {}, { now }), Real);
  stand.prototype = Real.prototype;
  globalThis.Date = new Proxy(stand, {
    construct: (_, args) => Reflect.construct(Real, args.length ? args : [now()]),
    // Date() called without `new` returns a string.
    apply: () => new Real(now()).toString(),
  });

  return () => {
    globalThis.Date = Real;
  };
}
