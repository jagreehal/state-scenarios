import { z } from 'zod';
import { unsignedJwt } from './jwt.js';
import type { Json, JsonObject } from './schema.js';

/** Keys whose values are secrets whatever they hold. */
const SECRET_KEY =
  /pass(word|phrase)?$|secret|api[-_]?key|private[-_]?key|access[-_]?key|credential|^otp$|^pin$|card[-_]?number|^cvc$|^cvv$|ssn|signature|^salt$|nonce/i;

/** Keys holding bearer values: a JWT keeps its claims, anything else is replaced. */
const TOKEN_KEY = /token|session[-_]?id|^sid$|^auth$|authorization|bearer|jwt|cookie/i;

/** URL params that carry credentials, e.g. `?key=` for maps APIs or `X-Amz-Signature` in signed URLs. */
const secretParam = (k: string) =>
  k.toLowerCase() === 'key' || /^sig$/i.test(k) || SECRET_KEY.test(k) || TOKEN_KEY.test(k);

/** Numeric bearer values: session ids. */
const NUMERIC_ID_KEY = /session[-_]?id$|^sid$/i;

/** Three base64url parts, anywhere in a string (e.g. after `Bearer `): a JWT when the first decodes to JSON. */
const JWT = /[\w-]+\.[\w-]+\.[\w-]*/g;

const PLACEHOLDER = '[redacted]';

const decode = (part: string): JsonObject | undefined => {
  try {
    const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const value: Json = JSON.parse(new TextDecoder().decode(bytes));

    return value instanceof Object && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Each JWT in `text` re-issued unsigned with the same claims, so the app still decodes it but no
 * server accepts it. A signed token whose claims can't be read is replaced whole.
 */
const unsign = (text: string) =>
  text.replace(JWT, (token) => {
    const [header = '', payload = '', signature = ''] = token.split('.');

    // `v1.2.3`, `www.example.com`: not a token.
    if (!decode(header)) return token;
    const claims = decode(payload);

    if (claims) return unsignedJwt(claims);

    return signature ? PLACEHOLDER : token;
  });

const isUnsignedJwt = (token: string) =>
  /^[\w-]+\.[\w-]+\.$/.test(token) && !!decode(token.split('.')[0] ?? '');

const isBasicCredential = (value: string) => {
  try {
    return atob(value).includes(':');
  } catch {
    return false;
  }
};

/** Credentials inside any string: `Bearer`/`Basic` values, `user:pass@` in URLs, and secret URL params. */
const scrub = (text: string) =>
  text
    .replace(/\bBearer\s+([\w.~+/=-]{8,})/g, (m, token: string) =>
      isUnsignedJwt(token) ? m : `Bearer ${PLACEHOLDER}`)
    .replace(/\bBasic\s+([\w+/=]{8,})/g, (m, value: string) =>
      isBasicCredential(value) ? `Basic ${PLACEHOLDER}` : m)
    .replace(/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g, `$1${PLACEHOLDER}@`)
    .replace(/([?&])([^=&\s#]+)=([^&\s#]+)/g, (m, sep: string, k: string) =>
      secretParam(k) ? `${sep}${k}=${PLACEHOLDER}` : m);

export interface Redacted {
  value: Json;
  /** Paths that changed, e.g. `user.accessToken`. */
  redacted: string[];
}

/**
 * Remove secrets from a recorded response body: strings under secret-like keys become
 * "[redacted]" and numbers become 0, and signed JWTs anywhere lose their signature but keep
 * their claims.
 */
export function redactSecrets(value: Json): Redacted {
  const redacted: string[] = [];

  /** `above`: the nearest secret-like key holding this node, e.g. `apiKey` for `apiKey.primary`. */
  const walk = (node: Json, path: string, key: string, above = ''): Json => {
    const text = z.string().safeParse(node);
    // A JWT keeps its claims, whatever key holds it: the app may decode it.
    const jwt = text.success ? unsign(text.data) : undefined;
    // Checked before the value's type: a card number or one-time code is often a number.
    // Token-like keys only for strings: `tokens: 3` is usually a count, not a credential.
    const secret = SECRET_KEY.test(key) || TOKEN_KEY.test(key) || !!above;
    // A secret key keeps its value only when the whole value is one token, now unsigned.
    const whole = jwt !== undefined && isUnsignedJwt(jwt);

    if (jwt !== undefined && secret && whole) {
      if (jwt !== text.data) redacted.push(path);

      return jwt;
    }

    const clean = jwt === undefined || secret ? undefined : scrub(jwt);

    if (clean !== undefined && clean !== text.data) {
      redacted.push(path);

      return clean;
    }

    const number = z.number().safeParse(node);

    if ((SECRET_KEY.test(key) || SECRET_KEY.test(above) || NUMERIC_ID_KEY.test(key)) && number.success) {
      redacted.push(path);

      return 0; // still a number, so the app's parsing and formatting keep working
    }

    if (secret && text.success && text.data) {
      redacted.push(path);

      return PLACEHOLDER;
    }

    if (text.success || number.success) return node;

    const holder = SECRET_KEY.test(key) || TOKEN_KEY.test(key) ? key : above;

    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}[${i}]`, key, holder));

    if (node instanceof Object) {
      // Header-style pairs: `{ name: "Authorization", value: "..." }`.
      const name = z.string().catch('').parse(node.name ?? node.key);
      const pair = SECRET_KEY.test(name) || TOKEN_KEY.test(name) ? name : '';

      return Object.fromEntries(
        Object.entries(node).map((
          [k, v],
        ) => [k, walk(v, path ? `${path}.${k}` : k, k, k === 'value' && pair ? pair : holder)]),
      );
    }

    return node;
  };

  return { value: walk(value, '', ''), redacted };
}

/**
 * Drop secret query params, such as `key` or `access_token`. Replay matches only the params an
 * entry lists, so the recorded entry still answers the request.
 */
export function redactQuery(query: Record<string, string>) {
  return {
    query: Object.fromEntries(Object.entries(query).filter(([k]) => !secretParam(k))),
    dropped: Object.keys(query).filter(secretParam),
  };
}
