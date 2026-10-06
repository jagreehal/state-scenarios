import { defineConfig } from 'tsup';

// Declarations come from `tsc` in the build script: TypeScript 7 removed the
// compiler API that tsup's dts step needs.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/panel.ts',
    'src/playwright.ts',
    'src/adapters/tanstack-query.ts',
    'src/adapters/zustand.ts',
    'src/adapters/redux.ts',
    'src/adapters/xstate.ts',
  ],
  format: ['esm'],
  target: 'es2022',
  sourcemap: true,
  clean: true,
});
