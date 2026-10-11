import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    // Compiles the .svelte modules that libraries such as
    // @tanstack/svelte-table import, so src/lib can be tested in Node.
    plugins: [svelte({ configFile: false })],
    test: {
      include: ['src/**/*.spec.ts'],
      server: {
        deps: {
          // These ship .svelte sources, so Vite has to transform them.
          inline: [/@tanstack\/svelte-/],
        },
      },
      coverage: {
        include: ['src/lib/**/*.ts'],
        exclude: ['src/**/*.spec.ts'],
      },
    },
  }),
);
