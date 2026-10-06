import { preact } from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // The preset also aliases react to preact/compat, so @xstate/react and state-scenarios-react work.
  plugins: [preact(), tailwindcss()],
  // "source" resolves workspace packages to their TypeScript: no build needed to develop.
  // dedupe: workspace packages (state-scenarios-react) resolve the one Preact this app installs.
  resolve: { conditions: ['source', ...defaultClientConditions], dedupe: ['preact'] },
  build: { target: 'esnext' },
});
