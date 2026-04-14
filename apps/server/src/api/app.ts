import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Elysia } from 'elysia';
import { node } from '@elysiajs/node';
import { swagger } from '@elysiajs/swagger';
import type { EmailRepository } from '../db/email-repository.js';
import type { Logger } from '../logger.js';
import type { Config } from '../types.js';
import { emailRoutes } from './routes/emails.js';
import { healthRoutes } from './routes/health.js';

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

function serveWeb() {
  // @ts-expect-error esbuild outputs ESM where import.meta.dirname is available
  const webDir = path.resolve(import.meta.dirname, 'web');
  const indexPath = path.join(webDir, 'index.html');
  const indexHtml = existsSync(indexPath)
    ? readFileSync(indexPath, 'utf8')
    : null;

  return new Elysia().get('/*', ({ params, set }) => {
    if (!indexHtml) return set.status = 404;

    const filePath = path.join(webDir, params['*'] || 'index.html');
    if (!filePath.startsWith(webDir)) return set.status = 403;

    if (existsSync(filePath)) {
      const ext = path.extname(filePath);
      set.headers['content-type'] = MIME_TYPES[ext] || 'application/octet-stream';
      return readFileSync(filePath);
    }

    set.headers['content-type'] = 'text/html';
    return indexHtml;
  }, { detail: { hide: true } });
}

export function createApp(
  repository: EmailRepository,
  config: Config,
  logger: Logger
) {
  const log = logger.child({ component: 'api' });

  const app = new Elysia({ adapter: node() })
    .onRequest(({ request }) => {
      log.debug({ method: request.method, url: request.url }, 'Request');
    })
    .onError(({ error, request }) => {
      log.error(
        { err: error, method: request.method, url: request.url },
        'Request error'
      );
    })
    .use(
      swagger({
        documentation: {
          info: {
            title: 'Mail Debugger API',
            version: '0.1.0',
            description:
              'REST API for managing emails caught by the Mail Debugger SMTP server.',
          },
          tags: [
            {
              name: 'Emails',
              description: 'Email management endpoints',
            },
            {
              name: 'Health',
              description: 'Server health and status',
            },
          ],
        },
      })
    )
    .use(emailRoutes(repository))
    .use(healthRoutes(repository, config))
    .use(serveWeb());

  return app;
}
