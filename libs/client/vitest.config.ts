import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts'],
        thresholds: {
          'src/lib/api-client.ts': { lines: 95, branches: 90 },
          'src/lib/errors.ts': { lines: 90, branches: 80 },
        },
      },
    },
  }),
);
