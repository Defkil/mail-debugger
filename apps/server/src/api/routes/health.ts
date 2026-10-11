import { Elysia, t } from 'elysia';
import type { MailService } from '../../mail/mail-service.js';
import { getVersion } from '../../version.js';

/** Facts about the running server that only exist after startup. */
export interface RuntimeInfo {
  smtpPort: number;
  apiPort: number;
  /** Bound IMAP port, when IMAP is enabled. */
  imapPort?: number;
  /** Whether /mcp serves MCP. */
  mcp?: boolean;
}

export function healthRoutes(service: MailService, info: () => RuntimeInfo) {
  return new Elysia().get(
    '/api/health',
    () => {
      const { smtpPort, apiPort, imapPort, mcp } = info();
      return {
        status: 'ok' as const,
        version: getVersion(),
        smtpPort,
        apiPort,
        ...(imapPort !== undefined && { imapPort }),
        ...(mcp && { mcp }),
        persistent: service.persistent,
        emailCount: service.stats().count,
      };
    },
    {
      detail: {
        tags: ['Health'],
        summary: 'Health check',
        description:
          'Returns the server status, version, bound ports (imapPort only when IMAP is enabled), whether MCP is enabled, storage mode and email count.',
      },
      response: t.Object({
        status: t.Literal('ok'),
        version: t.String(),
        smtpPort: t.Number(),
        apiPort: t.Number(),
        imapPort: t.Optional(t.Number()),
        mcp: t.Optional(t.Boolean()),
        persistent: t.Boolean(),
        emailCount: t.Number(),
      }),
    },
  );
}
