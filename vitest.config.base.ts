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
      // `pnpm test` collects coverage and prints a summary per project.
      // Projects set floors just below the measured coverage of the
      // modules that hold service, protocol and error logic: they catch
      // tests that get lost, they are not a percentage to chase.
      reporter: ['text-summary'],
    },
  },
});
