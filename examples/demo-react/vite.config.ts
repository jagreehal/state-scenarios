import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { stateScenarios } from 'state-scenarios/vite';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    msw({ mode: 'worker-only' }),
    // e2e points saves outside the scenarios glob, so saving doesn't reload pages under test.
    stateScenarios({ dir: process.env.STATE_SCENARIOS_SAVE_DIR ?? 'scenarios' }),
  ],
  // "source" resolves workspace packages to their TypeScript: no build needed to develop.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  build: { target: 'esnext' },
});
