import { Elysia, t } from 'elysia';
import type { EmailRepository } from '../../db/email-repository.js';
import type { Config } from '../../types.js';

export function healthRoutes(repository: EmailRepository, config: Config) {
  return new Elysia().get(
    '/api/health',
    () => ({
      status: 'ok' as const,
      smtpPort: config.smtpPort,
      apiPort: config.apiPort,
      persistent: config.persist,
      emailCount: repository.count(),
    }),
    {
      detail: {
        tags: ['Health'],
        summary: 'Health check',
        description:
          'Returns server status, configuration, and email count.',
      },
      response: t.Object({
        status: t.Literal('ok'),
        smtpPort: t.Number(),
        apiPort: t.Number(),
        persistent: t.Boolean(),
        emailCount: t.Number(),
      }),
    }
  );
}
