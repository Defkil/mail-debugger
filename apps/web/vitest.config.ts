import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.spec.ts'],
      coverage: {
        include: ['src/lib/**/*.ts'],
        exclude: ['src/**/*.spec.ts'],
      },
    },
  }),
);
