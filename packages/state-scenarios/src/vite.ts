import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { SAVE_ENDPOINT } from './link.js';
import { createSaveHandler } from './save.js';

export { SAVE_ENDPOINT } from './link.js';

export interface StateScenariosPluginOptions {
  /** Folder the panel's "Save to project" writes into, relative to the Vite root. Default "src/scenarios". */
  dir?: string;
}

/**
 * Dev-server plugin: lets the panel save a captured scenario straight into the project
 * instead of the Downloads folder. Only runs under `vite dev`, and only for this machine.
 */
export function stateScenarios({ dir = 'src/scenarios' }: StateScenariosPluginOptions = {}): Plugin {
  return {
    name: 'state-scenarios',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const handler = createSaveHandler({ dir: resolve(root, dir), root });
      server.middlewares.use(SAVE_ENDPOINT, (req, res) => void handler(req, res));
    },
  };
}
