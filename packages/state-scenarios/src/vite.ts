import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, searchForWorkspaceRoot } from 'vite';
import { isCode } from './code.js';
import { SAVE_ENDPOINT } from './link.js';
import { createSaveHandler } from './save.js';

export { SAVE_ENDPOINT } from './link.js';

export interface StateScenariosPluginOptions {
  /**
   * Folder the panel's "Save to project" writes into, relative to the Vite root or absolute.
   * With `inject`, also where scenarios are read from. Default "src/scenarios".
   */
  dir?: string;
  /**
   * Start state-scenarios in an app that doesn't call `startScenarios` itself: before the app's
   * entry runs, the page loads every scenario in `dir`, starts MSW and mounts the panel. Add the
   * plugin from a Vite config of your own that extends the app's, and the app needs no changes.
   */
  inject?: boolean | InjectOptions;
}

export interface InjectOptions {
  /**
   * Modules of MSW handlers, or globs of them, e.g. the app's Vitest mocks:
   * `['@/mocks/handlers', '@/mocks/*.handlers.ts']`. Each module's `handlers`
   * (or default) export answers beneath every scenario, first module first, and every handler
   * any of them exports can be named in a scenario's `"handlers"`, e.g. `["ordersEmpty"]`.
   * Resolved like the app's own imports, aliases included.
   */
  handlers?: string | string[];
  /** Scenario to use when the URL names none, e.g. a signed-in base. */
  defaultScenario?: string;
  /** Answer requests nothing covers with 501, as `startScenarios({ strict })`. */
  strict?: boolean;
  /** Open inline share links off localhost, as `startScenarios({ allowLinks })`. */
  allowLinks?: boolean;
  /** Requests scenarios don't care about, such as analytics, as `startScenarios({ ignore })`. */
  ignore?: (string | RegExp)[];
  /** Requests that reach the real network even in strict mode, as `startScenarios({ allow })`. */
  allow?: (string | RegExp)[];
  /** Mount the dev panel. Default true. */
  panel?: boolean;
  /**
   * Inject into `vite build` too, for demo recordings and preview deploys. The build then ships
   * the mocks, scenarios and panel, so build into a folder of its own and never deploy it as
   * the real app. Default false: only `vite dev`.
   */
  build?: boolean;
}

const START = 'virtual:state-scenarios/start';

const WORKER = 'mockServiceWorker.js';

// An external module script's attributes, in any order and with any quoting.
const MODULE = /\btype\s*=\s*(["']?)module\1(?=[\s/>]|$)/i;

const SRC = /\s\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * Dev-server plugin: lets the panel save a captured scenario straight into the project
 * instead of the Downloads folder, and with `inject`, runs scenarios in an app that has no
 * state-scenarios code. Only runs under `vite dev` (and `vite build` with `inject.build`),
 * and only saves for this machine.
 */
export function stateScenarios(
  { dir = 'src/scenarios', inject = false }: StateScenariosPluginOptions = {},
): Plugin {
  const options = inject === true ? {} : inject || undefined;
  const self = fileURLToPath(import.meta.url);
  let folder = '';
  let root = '';
  // The app's msw, so the worker script matches the library that registers it and its handlers.
  let appMsw: string | undefined;

  // Code, stylesheets, fonts and frames go straight to the network, ahead of MSW's own listener:
  // no handler answers them, and a cookie MSW can't read can't fail them and blank the page.
  const workerScript = () =>
    `const isCode = ${isCode.toString()};\n`
    + `const PASS = new Set(['script', 'style', 'font', 'document', 'iframe', 'frame', 'worker', 'sharedworker', 'manifest']);\n`
    + `self.addEventListener('fetch', (event) => {\n`
    + `  if (PASS.has(event.request.destination) || isCode(event.request.url)) event.stopImmediatePropagation();\n`
    + `});\n`
    + readFileSync(
      join(appMsw ?? dirname(createRequire(self).resolve('msw/package.json')), 'lib', WORKER),
      'utf8',
    );

  return {
    name: 'state-scenarios',
    apply: (_config, env) => env.command === 'serve' || !!options?.build,
    config(config) {
      if (!options) return undefined;
      const at = resolve(config.root ?? process.cwd());

      try {
        appMsw = dirname(createRequire(join(at, 'package.json')).resolve('msw/package.json'));
      } catch {
        appMsw = undefined;
      }

      // The injected code lives outside the app (here, and in `dir`), so Vite must serve it.
      return {
        server: { fs: { allow: [searchForWorkspaceRoot(at), resolve(self, '../..'), resolve(at, dir)] } },
        optimizeDeps: appMsw ? { include: ['msw/browser'] } : undefined,
      };
    },
    configResolved(config) {
      root = config.root;
      folder = resolve(root, dir);
    },
    configureServer(server) {
      const handler = createSaveHandler({ dir: folder, root });
      server.middlewares.use(SAVE_ENDPOINT, (req, res) => void handler(req, res));

      if (!options) return;
      server.middlewares.use(`${server.config.base}${WORKER}`, (_req, res) => {
        res.setHeader('content-type', 'text/javascript');
        res.end(workerScript());
      });

      // A scenario saved, edited or deleted reloads the page with the new catalog.
      server.watcher.add(folder);

      const reload = (file: string) => {
        if (!file.startsWith(folder) || !file.endsWith('.json')) return;
        const mod = server.moduleGraph.getModuleById(`\0${START}`);

        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', reload).on('change', reload).on('unlink', reload);
    },
    generateBundle() {
      if (options) this.emitFile({ type: 'asset', fileName: WORKER, source: workerScript() });
    },
    transformIndexHtml: {
      // Before Vite adds its own client script, so only the app's entries are wrapped.
      order: 'pre',
      handler(html) {
        if (!options) return html;

        // Scenarios start before the app's entry runs, so its first requests are already mocked.
        // A promise chain rather than top-level await, which older build targets reject.
        return html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
          const src = SRC.exec(attrs);

          if (!MODULE.test(attrs) || !src) return tag;
          const entry = src[1] ?? src[2] ?? src[3] ?? '';

          // Other attributes (crossorigin, nonce) stay on the inline script.
          return `<script${attrs.replace(src[0], '')}>${startThen(entry)}</script>`;
        });
      },
    },
    async resolveId(id, importer) {
      if (id === START) return `\0${START}`;

      // The injected module's own imports resolve from this package, not the app; msw too when
      // the app has none.
      if (
        importer === `\0${START}` && (id.startsWith('state-scenarios') || (!appMsw && id.startsWith('msw')))
      ) {
        return this.resolve(id, self, { skipSelf: true });
      }

      return null;
    },
    load(id) {
      if (id !== `\0${START}` || !options) return null;

      return startModule(options, readScenarios(folder), appMsw !== undefined);
    },
  };
}

/**
 * Start scenarios, then import the app's entry. Waiting lets the page finish loading first, so
 * DOMContentLoaded and load are held back until the entry has run and then sent again: an app
 * that listens for them still starts, and every listener sees each event once.
 */
const startThen = (entry: string) =>
  [
    `const held = [];`,
    `const hold = (e) => { held.push(e.type); e.stopImmediatePropagation(); };`,
    `addEventListener('DOMContentLoaded', hold, true);`,
    `addEventListener('load', hold, true);`,
    `import(${JSON.stringify(START)}).then((m) => m.started).then(() => import(${JSON.stringify(entry)}))`,
    `  .finally(() => {`,
    `    removeEventListener('DOMContentLoaded', hold, true);`,
    `    removeEventListener('load', hold, true);`,
    `    for (const type of held) {`,
    `      if (type === 'load') dispatchEvent(new Event('load'));`,
    `      else document.dispatchEvent(new Event(type, { bubbles: true }));`,
    `    }`,
    `  });`,
  ].join('\n');

function readScenarios(folder: string): unknown[] {
  let files: string[];

  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json')).toSorted();
  } catch {
    return [];
  }

  return files.map((f) => JSON.parse(readFileSync(join(folder, f), 'utf8')));
}

/** A list of strings and RegExps as JavaScript source. */
const rules = (list: (string | RegExp)[] = []) =>
  `[${
    list.map((r) => (r instanceof RegExp
      ? `new RegExp(${JSON.stringify(r.source)}, ${JSON.stringify(r.flags)})`
      : JSON.stringify(r))
    ).join(', ')
  }]`;

/** The module the page runs first: everything an app's own setup would do. */
function startModule(options: InjectOptions, scenarios: unknown[], appMsw: boolean) {
  const modules = [options.handlers ?? []].flat();
  // Each spec is a list of modules: one import, or every file a glob matches.
  const names = modules.map((_, i) => `...handlers${i}`).join(', ');
  const { defaultScenario, strict, allowLinks } = options;
  // With the app's msw or handlers, the worker is made here; otherwise state-scenarios starts its own.
  const worker = appMsw || modules.length > 0;
  const serviceWorker = `{ url: import.meta.env.BASE_URL + ${JSON.stringify(WORKER)} }`;

  return [
    `import { isCode, namedHandlers, startScenarios } from 'state-scenarios';`,
    `import { cookiesAdapter } from 'state-scenarios/cookies';`,
    `import { storageAdapter } from 'state-scenarios/storage';`,
    options.panel === false ? '' : `import { mountPanel } from 'state-scenarios/panel';`,
    worker ? `import { http, passthrough } from 'msw';\nimport { setupWorker } from 'msw/browser';` : '',
    ...modules.map((m, i) =>
      m.includes('*')
        ? `const handlers${i} = Object.values(import.meta.glob(${JSON.stringify(m)}, { eager: true }));`
        : `import * as module${i} from ${JSON.stringify(m)};\nconst handlers${i} = [module${i}];`
    ),
    `export const started = (async () => {`,
    worker
      ? [
        // A handler such as `*/orders/:id` would otherwise answer the app's own lazy chunks.
        `const code = http.all(/./, ({ request }) => (isCode(request.url) ? passthrough() : undefined));`,
        `const worker = setupWorker(code, ...[${names}].flatMap((m) => m.handlers ?? m.default ?? []));`,
        `await worker.start({ quiet: true, onUnhandledRequest: 'bypass', serviceWorker: ${serviceWorker} });`,
      ].join('\n')
      : '',
    `const session = await startScenarios({`,
    `  ...${JSON.stringify({ scenarios, defaultScenario, strict, allowLinks })},`,
    `  handlers: namedHandlers(${names}),`,
    `  ignore: ${rules(options.ignore)},`,
    `  allow: ${rules(options.allow)},`,
    `  adapters: [cookiesAdapter(), storageAdapter(), storageAdapter({ area: 'session' })],`,
    worker ? `  worker,` : `  workerOptions: { serviceWorker: ${serviceWorker} },`,
    `});`,
    options.panel === false ? '' : 'mountPanel(session);',
    `})();`,
  ].filter(Boolean).join('\n');
}
