import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Every spec starts its own servers on free ports.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
