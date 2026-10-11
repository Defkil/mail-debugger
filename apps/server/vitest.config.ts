import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts', 'src/main.ts'],
        // No floors for the entry points, the logger and the stdio bridge:
        // they run in spawned processes, which the end-to-end tests cover.
        thresholds: {
          'src/mail/**': { lines: 95, branches: 95 },
          'src/db/**': { lines: 90, branches: 80 },
          'src/api/**': { lines: 90, branches: 80 },
          'src/imap/**': { lines: 80, branches: 60 },
          'src/mcp/tools.ts': { lines: 95, branches: 80 },
        },
      },
    },
  }),
);
