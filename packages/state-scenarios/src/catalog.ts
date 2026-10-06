import {
  type Json,
  type JsonObject,
  type NetworkEntry,
  parseScenario,
  type Scenario,
  type ScenarioInput,
} from './schema.js';

/**
 * A business rule a resolved scenario must satisfy, beyond schema shape.
 * Return a message (or several) for each violation.
 */
export type ScenarioRule = (scenario: Scenario) => string | string[] | void | undefined;

/** Identity helper for typing rule lists. */
export const defineScenarioRules = (rules: ScenarioRule[]) => rules;

export interface Catalog {
  list: Scenario[];
  get(name: string): Scenario | undefined;
  /** Flatten `extends` into one self-contained scenario, then check the rules. */
  resolve(scenario: Scenario): Scenario;
  /** Resolve every scenario; returns one message per problem. */
  check(): string[];
}

export function createCatalog(
  raw: ScenarioInput[],
  { rules = [] }: { rules?: ScenarioRule[]; } = {},
): Catalog {
  const byName = new Map<string, Scenario>();

  for (const [i, data] of raw.entries()) {
    const s = parseScenario(data, `#${i}`);

    // Commas join names in ?scenario=a,b, so a catalog name can't contain one.
    if (s.name.includes(',')) throw new Error(`Scenario name "${s.name}" can't contain a comma`);

    if (byName.has(s.name)) throw new Error(`Duplicate scenario name "${s.name}"`);
    byName.set(s.name, s);
  }

  const flatten = (s: Scenario, seen: string[]): Scenario => {
    if (seen.includes(s.name)) {
      throw new Error(`Circular extends: ${[...seen, s.name].join(' -> ')}`);
    }

    const parents = [s.extends ?? []].flat().map((name) => {
      const parent = byName.get(name);

      if (!parent) throw new Error(`Scenario "${s.name}" extends unknown "${name}"`);

      return flatten(parent, [...seen, s.name]);
    });

    const { extends: _extends, $schema: _schema, ...own } = s;

    // Start from an empty base so standalone scenarios are normalised too (remove entries, nulls).
    return [...parents, own].reduce(merge, { name: own.name });
  };

  const resolve = (s: Scenario) => {
    const flat = flatten(s, []);
    const violations = rules.flatMap((rule) => rule(flat) ?? []);

    if (violations.length) {
      throw new Error(`Scenario "${s.name}" breaks rules:\n${violations.map((m) => `- ${m}`).join('\n')}`);
    }

    return flat;
  };

  return {
    list: [...byName.values()],
    get: (name) => byName.get(name),
    resolve,
    check: () =>
      [...byName.values()].flatMap((s) => {
        try {
          resolve(s);

          return [];
        } catch (err) {
          return [err instanceof Error ? err.message : String(err)];
        }
      }),
  };
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => a.localeCompare(b);

const routeKey = (e: NetworkEntry) =>
  `${e.method} ${e.path} ${JSON.stringify(Object.entries(e.query ?? {}).toSorted(byKey))}`;

function merge(base: Scenario, over: Scenario): Scenario {
  const overKeys = new Set((over.network ?? []).map(routeKey));

  return {
    ...base,
    ...over,
    // Own-only fields: a child describes and finishes rendering differently.
    description: over.description,
    tags: over.tags,
    ready: over.ready,
    // A null param removes the inherited one.
    url: Object.fromEntries(Object.entries({ ...base.url, ...over.url }).filter(([, v]) => v !== null)),
    network: [
      ...(over.network ?? []).filter((e) => !e.remove),
      ...(base.network ?? []).filter((e) => !overKeys.has(routeKey(e))),
    ],
    state: mergeObjects(base.state ?? {}, over.state ?? {}),
  };
}

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  value instanceof Object && !Array.isArray(value);

function mergeObjects(base: JsonObject, over: JsonObject): JsonObject {
  const out = { ...base };

  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = deepMerge(base[k], v);
  }

  return out;
}

/** Objects merge recursively, `null` deletes a key, anything else replaces. */
export function deepMerge(base: Json | undefined, over: Json): Json {
  return isJsonObject(base) && isJsonObject(over) ? mergeObjects(base, over) : over;
}
