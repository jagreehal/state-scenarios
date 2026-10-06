import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5179' },
  webServer: [
    {
      command: 'pnpm --filter demo-react exec vite --port 5179 --strictPort',
      url: 'http://localhost:5179',
      reuseExistingServer: true,
    },
    {
      // The Preact + XState example.
      command: 'pnpm --filter who-speaks-what-preact exec vite --port 5180 --strictPort',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
    },
  ],
});
