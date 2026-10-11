import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts', 'src/main.ts'],
        // The interactive inbox itself needs a terminal; its logic is
        // covered through the wiring and screen specs.
        thresholds: {
          'src/commands/**': { lines: 95, branches: 90 },
          'src/config/**': { lines: 95, branches: 90 },
          'src/formatter/**': { lines: 95, branches: 85 },
        },
      },
    },
  }),
);
