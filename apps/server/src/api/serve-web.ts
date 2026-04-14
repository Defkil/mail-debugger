import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Elysia } from 'elysia';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function serveWeb() {
  // @ts-expect-error esbuild outputs ESM where import.meta.dirname is available
  const webDir = path.resolve(import.meta.dirname, 'web');
  const indexPath = path.join(webDir, 'index.html');
  const indexHtml = existsSync(indexPath)
    ? readFileSync(indexPath, 'utf8')
    : null;

  return new Elysia().get(
    '/*',
    ({ params, set }) => {
      if (!indexHtml) return (set.status = 404);

      const filePath = path.join(webDir, params['*'] || 'index.html');
      if (!filePath.startsWith(webDir)) return (set.status = 403);

      if (existsSync(filePath)) {
        const ext = path.extname(filePath);
        set.headers['content-type'] =
          MIME_TYPES[ext] || 'application/octet-stream';
        return readFileSync(filePath);
      }

      set.headers['content-type'] = 'text/html';
      return indexHtml;
    },
    { detail: { hide: true } },
  );
}
