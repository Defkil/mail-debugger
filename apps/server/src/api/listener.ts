import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NodeHttp1Handler } from 'srvx';
import { toNodeHandler } from 'srvx/node';
import type { Logger } from '../logger.js';
import { listen } from '../net-listen.js';

/** Headers every HTTP response carries unless the handler set them. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function withSecurityHeaders(response: Response): Response {
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  } catch {
    // Some responses have immutable headers; copy them instead.
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export interface HttpListener {
  readonly address: AddressInfo;
  /** Stops accepting connections; in-flight requests get `timeoutMs`. */
  close(timeoutMs: number): Promise<void>;
}

/**
 * Serves a Fetch-style handler on a plain `node:http` server. Unlike
 * `app.listen()` of the Elysia Node adapter it binds exclusively (a port in
 * use is an error, not a shared port), reports the bound port and leaves
 * signal handling to the caller. The request's abort signal fires when the
 * client disconnects.
 */
export async function listenHttp(
  handler: (request: Request) => Response | Promise<Response>,
  options: { host: string; port: number; logger: Logger },
): Promise<HttpListener> {
  const log = options.logger.child({ component: 'http' });
  // The handler serves HTTP/1 requests here; srvx also types it for HTTP/2.
  const nodeHandler = toNodeHandler(async (request: Request) =>
    withSecurityHeaders(await handler(request)),
  ) as NodeHttp1Handler;
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        await nodeHandler(req, res);
      } catch (error) {
        log.error({ err: error }, 'Could not send a response');
        if (res.headersSent) {
          res.destroy();
        } else {
          res.statusCode = 500;
          res.end();
        }
      }
    })();
  });

  const address = await listen(server, options.port, options.host);
  server.on('error', (error) => log.error({ err: error }, 'HTTP server error'));

  return {
    address,
    async close(timeoutMs) {
      if (!server.listening) return;
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeIdleConnections();
      const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
      timer.unref();
      await closed;
      clearTimeout(timer);
    },
  };
}
