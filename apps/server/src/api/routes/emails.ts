import { Elysia, t } from 'elysia';
import type { EmailRepository } from '../../db/email-repository.js';

export function emailRoutes(repository: EmailRepository) {
  return new Elysia()
    .get(
      '/api/emails',
      ({ query }) => {
        const filter: Record<string, string | undefined> = {};
        if (query.from) filter.from = query.from;
        if (query.to) filter.to = query.to;
        if (query.subject) filter.subject = query.subject;
        if (query.since) filter.since = query.since;
        if (query.until) filter.until = query.until;

        const data = repository.findAll(
          Object.keys(filter).length > 0 ? filter : undefined
        );
        return { data };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'List emails',
          description:
            'Returns all caught emails, optionally filtered by from, to, subject, since, until.',
        },
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          since: t.Optional(t.String()),
          until: t.Optional(t.String()),
        }),
      }
    )
    .get(
      '/api/emails/:id',
      ({ params, set }) => {
        const email = repository.findById(Number(params.id));
        if (!email) {
          set.status = 404;
          return { error: 'Email not found' };
        }
        return { data: email };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'Get email by ID',
          description:
            'Returns full email details including body and attachments.',
        },
        params: t.Object({
          id: t.String(),
        }),
      }
    )
    .delete(
      '/api/emails/:id',
      ({ params, set }) => {
        const deleted = repository.deleteById(Number(params.id));
        if (!deleted) {
          set.status = 404;
          return { error: 'Email not found' };
        }
        return { deleted: true };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'Delete email by ID',
          description: 'Deletes a single email.',
        },
        params: t.Object({
          id: t.String(),
        }),
      }
    )
    .delete(
      '/api/emails',
      () => {
        const deleted = repository.deleteAll();
        return { deleted };
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'Delete all emails',
          description:
            'Deletes all caught emails and returns the count of deleted emails.',
        },
      }
    );
}
