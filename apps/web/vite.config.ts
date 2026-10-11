import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

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
