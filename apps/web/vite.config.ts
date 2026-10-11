import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The version of the published package names the app version, so that the
// same source always builds the same files (the default is a timestamp).
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      // Static single-page build served by the mail-debugger server; unknown
      // paths fall back to index.html for client-side routing.
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        fallback: 'index.html',
        strict: false,
      }),
      version: { name: version },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // The server only accepts its own origin; present the dev server's
        // requests as same-origin ones.
        headers: { origin: 'http://localhost:3000' },
      },
    },
  },
});
