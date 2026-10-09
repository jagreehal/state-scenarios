import { expect, test } from 'vitest';

// Next.js renders client components on the server, so every entry an app imports must load without a DOM.
test.each([
  'state-scenarios',
  'state-scenarios/panel',
  'state-scenarios/cookies',
  'state-scenarios/tanstack-query',
  'state-scenarios/zustand',
  'state-scenarios/redux',
  'state-scenarios/xstate',
])('%s loads without a DOM', async (entry) => {
  expect(globalThis.document).toBeUndefined();
  await expect(import(entry)).resolves.toBeDefined();
});
