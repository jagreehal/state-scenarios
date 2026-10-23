import { z } from 'zod';
import type { TypedAdapter } from '../runtime.js';
import { type Json, JsonSchema, parseJson } from '../schema.js';

const ItemsSchema = z.record(z.string(), JsonSchema);

const Structured = z.union([z.array(JsonSchema), z.record(z.string(), JsonSchema)]);

/**
 * Connects `localStorage` (or `sessionStorage` with `area: 'session'`) as `state.localStorage`
 * (or your key): `{ "theme": "dark", "auth": { "token": "e2e" } }`. Strings are stored as
 * written, anything else as JSON, which is how persisted stores (zustand `persist`, redux-persist)
 * keep theirs. Applied before the app renders; the listed keys are set, others are left alone.
 */
export const storageAdapter = (
  { area = 'local', key = area === 'local' ? 'localStorage' : 'sessionStorage' }: {
    area?: 'local' | 'session';
    key?: string;
  } = {},
): TypedAdapter<Record<string, Json>> => {
  const storage = () => (area === 'local' ? localStorage : sessionStorage);

  return {
    key,
    schema: ItemsSchema,
    apply: (items) => {
      for (const [name, value] of Object.entries(items)) {
        const text = z.string().safeParse(value);
        storage().setItem(name, text.success ? text.data : JSON.stringify(value));
      }
    },
    // Stored JSON objects and arrays read back as JSON, so a captured scenario stays readable.
    read: () =>
      Object.fromEntries(
        Array.from({ length: storage().length }, (_, i) => storage().key(i) ?? '')
          // The runtime's and panel's own keys aren't the app's state.
          .filter((name) => !/^(state-scenarios|scenario-panel):/.test(name))
          .map((name) => {
            const text = storage().getItem(name) ?? '';

            try {
              const parsed = Structured.safeParse(parseJson(text));

              return [name, parsed.success ? parsed.data : text];
            } catch {
              return [name, text];
            }
          }),
      ),
    // Stores read storage once, when they start.
    inPlace: false,
    // Storage outlives the scenario and often holds a session, so only catalog scenarios set it.
    fromLinks: false,
  };
};
