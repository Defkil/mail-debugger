import { defineConfig } from 'vitest/config';

// Shared Vitest defaults for every project in the workspace.
// Projects extend this via `mergeConfig` and add their own
// `include` / `exclude` patterns, which vary by project layout.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
