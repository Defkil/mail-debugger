import { Elysia } from 'elysia';
import { node } from '@elysiajs/node';
import { swagger } from '@elysiajs/swagger';
import type { EmailRepository } from '../db/email-repository.js';
import type { Logger } from '../logger.js';
import type { Config } from '../types.js';
import { emailRoutes } from './routes/emails.js';
import { healthRoutes } from './routes/health.js';

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
    .use(healthRoutes(repository, config));

  return app;
}
