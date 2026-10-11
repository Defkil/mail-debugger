import { Elysia } from 'elysia';
import { node } from '@elysiajs/node';
import { openapi } from '@elysiajs/openapi';
import type { Logger } from '../logger.js';
import { ServiceError } from '../mail/errors.js';
import type { McpEndpoint } from '../mcp/http.js';
import type { MailService } from '../mail/mail-service.js';
import { getVersion } from '../version.js';
import { checkRequest, type HttpPolicy } from './guards.js';
import { HttpError, jsonError, toHttpError } from './http-errors.js';
import { emailRoutes } from './routes/emails.js';
import { healthRoutes, type RuntimeInfo } from './routes/health.js';
import { createStaticHandler } from './static-files.js';

export interface CreateAppOptions {
  service: MailService;
  logger: Logger;
  /** Policy for Host, Origin and the API token; read per request. */
  policy: () => HttpPolicy;
  /** Bound ports, read per request. */
  info: () => RuntimeInfo;
  /** Directory of the built web inbox; omit for the API-only server. */
  webDir?: string;
  /** The MCP endpoint, when enabled with --mcp. */
  mcp?: McpEndpoint;
}

export function createApp(options: CreateAppOptions) {
  const { service } = options;
  const log = options.logger.child({ component: 'http' });

  const app = new Elysia({ adapter: node() })
    .onRequest(({ request }) => {
      const { pathname } = new URL(request.url);
      log.debug({ method: request.method, path: pathname }, 'Request');
      const rejection = checkRequest(options.policy(), request, pathname);
      return rejection ? jsonError(rejection) : undefined;
    })
    .onError(({ code, error, request }) => {
      // Elysia derives `code` from a `status` property, so own errors go first.
      if (error instanceof HttpError) return jsonError(error);
      if (code === 'NOT_FOUND') {
        return jsonError(new HttpError(404, 'NOT_FOUND', 'Not found'));
      }
      if (code === 'VALIDATION' || code === 'PARSE') {
        return jsonError(
          new HttpError(400, 'INVALID_ARGUMENT', 'Invalid request parameters'),
        );
      }
      const httpError = toHttpError(error);
      // A client that disconnected (e.g. during a wait) is not a failure.
      if (
        httpError.status >= 500 &&
        !(error instanceof ServiceError) &&
        !request.signal.aborted
      ) {
        log.error(
          { err: error, method: request.method, url: request.url },
          'Request failed',
        );
      }
      return jsonError(httpError);
    })
    .use(
      openapi({
        // Keep the documentation at the paths of the former swagger plugin.
        path: '/swagger',
        documentation: {
          info: {
            title: 'Mail Debugger API',
            version: getVersion(),
            description:
              'REST API for managing emails caught by the Mail Debugger SMTP server. Errors are JSON objects of the form {"error": {"code", "message"}}.',
          },
          tags: [
            { name: 'Emails', description: 'Email management endpoints' },
            { name: 'Health', description: 'Server health and status' },
          ],
        },
      }),
    )
    .use(emailRoutes(service))
    .use(healthRoutes(service, options.info));

  // Unknown API paths stay JSON 404s instead of reaching the web inbox. Each
  // method is registered on its own: Elysia prefers a GET wildcard over an
  // ALL route.
  const hidden = { detail: { hide: true } };
  app
    .get('/api/*', unknownApiPath, hidden)
    .post('/api/*', unknownApiPath, hidden)
    .put('/api/*', unknownApiPath, hidden)
    .patch('/api/*', unknownApiPath, hidden)
    .delete('/api/*', unknownApiPath, hidden);

  // MCP reads the raw request: Elysia must not consume the body.
  const mcp = ({ request }: { request: Request }) => {
    const endpoint = options.mcp;
    if (!endpoint) {
      throw new HttpError(
        404,
        'NOT_FOUND',
        'MCP is not enabled; start mail-debugger with --mcp',
      );
    }
    return endpoint.fetch(request);
  };
  const raw = { parse: 'none' as const, ...hidden };
  app
    .get('/mcp', mcp, raw)
    .post('/mcp', mcp, raw)
    .delete('/mcp', mcp, raw)
    .put('/mcp', mcp, raw)
    .patch('/mcp', mcp, raw)
    .get('/mcp/*', unknownMcpPath, hidden)
    .post('/mcp/*', unknownMcpPath, hidden)
    .delete('/mcp/*', unknownMcpPath, hidden);

  const staticHandler = options.webDir
    ? createStaticHandler(options.webDir)
    : undefined;
  if (staticHandler) {
    app.get(
      '/*',
      ({ request }) => staticHandler(new URL(request.url).pathname),
      {
        detail: { hide: true },
      },
    );
  }
  return app;
}

function unknownApiPath(): never {
  throw new HttpError(404, 'NOT_FOUND', 'No such API endpoint');
}

function unknownMcpPath(): never {
  throw new HttpError(404, 'NOT_FOUND', 'The MCP endpoint is /mcp');
}

export type App = ReturnType<typeof createApp>;
