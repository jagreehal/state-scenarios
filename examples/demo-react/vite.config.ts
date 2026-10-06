import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), msw({ mode: 'worker-only' })],
  // "source" resolves workspace packages to their TypeScript: no build needed to develop.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  build: { target: 'esnext' },
});
