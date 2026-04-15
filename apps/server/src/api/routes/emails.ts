import { Elysia, t } from 'elysia';
import { pickEmailFilter } from '@mail-debugger/types';
import type { EmailRepository } from '../../db/email-repository.js';

export function emailRoutes(repository: EmailRepository) {
  return new Elysia()
    .get(
      '/api/emails',
      ({ query }) => {
        const filter = pickEmailFilter(query);
        const limit = query.limit ? Number(query.limit) : undefined;
        const offset = query.offset ? Number(query.offset) : undefined;

        return repository.findAll(filter, limit, offset);
      },
      {
        detail: {
          tags: ['Emails'],
          summary: 'List emails',
          description: 'Returns paginated emails, optionally filtered.',
        },
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
          subject: t.Optional(t.String()),
          since: t.Optional(t.String()),
          until: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      },
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
      },
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
      },
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
      },
    );
}
