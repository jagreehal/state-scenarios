/**
 * Whether a request is for code or a stylesheet, which fixtures must never answer. The worker
 * can't see a request's destination, so code is recognised by its path.
 */
export const isCode = (href: string) => {
  const { pathname } = new URL(href);

  return /\.(m?[jt]sx?|css|s[ac]ss|less|html?|wasm)$/i.test(pathname)
    || pathname.startsWith('/@') || pathname.includes('/node_modules/');
};
