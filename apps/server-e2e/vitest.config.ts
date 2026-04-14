import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './src/global-setup.ts',
    setupFiles: ['./src/test-setup.ts'],
  },
});
