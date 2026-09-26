import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tests run against in-process fakes; no network, no real credentials.
    hookTimeout: 15000,
    testTimeout: 15000,
  },
});
