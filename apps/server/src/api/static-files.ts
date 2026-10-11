import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Maps a URL path to a file strictly inside `root`. Returns undefined for
 * undecodable paths, NUL bytes, backslashes (a separator on Windows only;
 * no web asset contains one) and anything that escapes the root.
 */
export function resolveStaticPath(
  root: string,
  urlPath: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const resolved = path.resolve(
    root,
    `.${path.posix.normalize(`/${decoded}`)}`,
  );
  const relative = path.relative(root, resolved);
  const outside =
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return outside ? undefined : resolved;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the static web inbox from `root`. Existing files are returned with
 * their content type; paths without a file extension get index.html for
 * client-side routing; anything else is a 404.
 */
export function createStaticHandler(
  root: string,
): ((urlPath: string) => Response) | undefined {
  const indexFile = path.join(root, 'index.html');
  if (!isFile(indexFile)) return undefined;
  const indexHtml = readFileSync(indexFile);

  const indexResponse = () =>
    new Response(indexHtml, {
      headers: {
        'content-type': CONTENT_TYPES['.html'],
        'cache-control': 'no-cache',
        'x-frame-options': 'DENY',
      },
    });

  return (urlPath) => {
    if (urlPath === '/' || urlPath === '/index.html') return indexResponse();
    const file = resolveStaticPath(root, urlPath);
    if (file && isFile(file)) {
      const extension = path.extname(file).toLowerCase();
      return new Response(readFileSync(file), {
        headers: {
          'content-type':
            CONTENT_TYPES[extension] ?? 'application/octet-stream',
          'cache-control': urlPath.startsWith('/_app/immutable/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
          ...(extension === '.html' && { 'x-frame-options': 'DENY' }),
        },
      });
    }
    if (file && path.extname(file) === '') return indexResponse();
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': CONTENT_TYPES['.txt'] },
    });
  };
}
