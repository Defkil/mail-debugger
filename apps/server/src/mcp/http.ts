import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Logger } from '../logger.js';
import type { MailService } from '../mail/mail-service.js';
import { createMcpServer } from './server.js';
import { WaitSlots } from './tools.js';

/** Largest MCP request body. */
export const MAX_MCP_BODY_BYTES = 64 * 1024;
/** Most MCP HTTP requests in progress at once. */
export const MAX_MCP_REQUESTS = 64;

export interface McpEndpointOptions {
  service: MailService;
  logger: Logger;
  /** Offer delete_email and clear_emails. */
  allowMutations: boolean;
}

/** The streamable HTTP endpoint at /mcp, as a Fetch handler. */
export interface McpEndpoint {
  readonly allowMutations: boolean;
  /** wait_for_email calls in progress. */
  readonly pendingWaits: number;
  fetch(request: Request): Promise<Response>;
  /** Aborts calls in progress; later requests fail. */
  close(): Promise<void>;
}

/**
 * Serves MCP over streamable HTTP. Every request gets a fresh MCP server
 * over the shared mailbox: clients of the 2026-07-28 protocol are served
 * per request, 2025-era clients by the SDK's stateless fallback. Host,
 * Origin and the bearer token are checked before a request gets here.
 */
export function createMcpEndpoint(options: McpEndpointOptions): McpEndpoint {
  const log = options.logger.child({ component: 'mcp' });
  const context = {
    service: options.service,
    logger: log,
    waits: new WaitSlots(),
    allowMutations: options.allowMutations,
  };
  const handler = createMcpHandler(() => createMcpServer(context), {
    legacy: 'stateless',
    maxRequestBodySize: MAX_MCP_BODY_BYTES,
    // No change notifications are published, so few listeners make sense.
    maxSubscriptions: 8,
    onerror: (error) => log.debug({ err: error }, 'MCP request failed'),
  });

  let active = 0;
  return {
    allowMutations: options.allowMutations,
    get pendingWaits() {
      return context.waits.pending;
    },
    async fetch(request) {
      request.signal.throwIfAborted();
      if (active >= MAX_MCP_REQUESTS) {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32_000,
              message: 'Too many MCP requests in progress; retry later',
            },
            id: null,
          },
          { status: 429, headers: { 'retry-after': '1' } },
        );
      }
      active++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active--;
        request.signal.removeEventListener('abort', release);
      };
      // Reading the signal makes the HTTP layer abort it on disconnect,
      // which cancels a tool call in progress.
      request.signal.addEventListener('abort', release, { once: true });
      try {
        return track(await handler.fetch(request), request.signal, release);
      } catch (error) {
        release();
        throw error;
      }
    },
    close: () => handler.close(),
  };
}

/** Calls `done` once the response body is finished or cancelled. */
function track(
  response: Response,
  signal: AbortSignal,
  done: () => void,
): Response {
  if (!response.body) {
    done();
    return response;
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  void (async () => {
    try {
      await response.body?.pipeTo(writable, { signal });
    } catch {
      // The client went away; the stream is cancelled.
    } finally {
      done();
    }
  })();
  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
