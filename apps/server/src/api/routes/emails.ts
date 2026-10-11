import { Elysia, t } from 'elysia';
import type { MailService } from '../../mail/mail-service.js';
import { emailNotFound } from '../http-errors.js';
import { parseFilter, parseId, parsePage } from '../params.js';

const errorSchema = t.Object({
  error: t.Object({ code: t.String(), message: t.String() }),
});

export function emailRoutes(service: MailService) {
  return new Elysia()
    .get(
      '/api/emails',
      ({ query }) => service.list(parseFilter(query), parsePage(query)),
      {
        detail: {
          tags: ['Emails'],
          summary: 'List emails',
          description:
            'Returns emails newest first, optionally filtered. from, to and subject are case-insensitive substrings; since and until are inclusive (a date without time covers the whole UTC day).',
        },
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          since: t.Optional(
            t.String({ description: 'YYYY-MM-DD or ISO 8601 date-time' }),
          ),
          until: t.Optional(
            t.String({ description: 'YYYY-MM-DD or ISO 8601 date-time' }),
          ),
          limit: t.Optional(t.String({ description: '1 to 200, default 50' })),
          offset: t.Optional(t.String({ description: 'default 0' })),
        }),
      },
    )
    .get(
      '/api/emails/:id',
      ({ params }) => {
        const email = service.get(parseId(params.id));
        if (!email) throw emailNotFound();
        return { data: email };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'Get email by ID',
          description:
            'Returns full email details including body and attachments.',
        },
        params: t.Object({ id: t.String() }),
        response: { 404: errorSchema },
      },
    )
    .delete(
      '/api/emails/:id',
      ({ params }) => {
        if (!service.delete(parseId(params.id), 'rest')) throw emailNotFound();
        return { deleted: true };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'Delete email by ID',
          description: 'Deletes a single email.',
        },
        params: t.Object({ id: t.String() }),
      },
    )
    .delete('/api/emails', () => ({ deleted: service.clear('rest') }), {
      detail: {
        tags: ['Emails'],
        summary: 'Delete all emails',
        description:
          'Deletes all caught emails and returns the count of deleted emails.',
      },
    });
}
