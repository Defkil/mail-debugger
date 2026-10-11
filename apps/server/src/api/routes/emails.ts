import { Elysia, t } from 'elysia';
import type { MailService } from '../../mail/mail-service.js';
import { emailNotFound } from '../http-errors.js';
import {
  parseFilter,
  parseId,
  parseIndex,
  parsePage,
  parseWait,
} from '../params.js';

const errorSchema = t.Object({
  error: t.Object({ code: t.String(), message: t.String() }),
});

const filterQuery = {
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  subject: t.Optional(t.String()),
  since: t.Optional(
    t.String({ description: 'YYYY-MM-DD or ISO 8601 date-time' }),
  ),
  until: t.Optional(
    t.String({ description: 'YYYY-MM-DD or ISO 8601 date-time' }),
  ),
};

const FILTER_DESCRIPTION =
  'from, to and subject are case-insensitive substrings; since and until are inclusive (a date without time covers the whole UTC day).';

export function emailRoutes(service: MailService) {
  return (
    new Elysia()
      .get(
        '/api/emails',
        ({ query }) => service.list(parseFilter(query), parsePage(query)),
        {
          detail: {
            tags: ['Emails'],
            summary: 'List emails',
            description: `Returns emails newest first, optionally filtered, with the total number of matches. highWatermark (the highest id allocated so far) and mailboxId form the cursor for /api/emails/wait. ${FILTER_DESCRIPTION}`,
          },
          query: t.Object({
            ...filterQuery,
            limit: t.Optional(
              t.String({ description: '1 to 200, default 50' }),
            ),
            offset: t.Optional(t.String({ description: 'default 0' })),
          }),
        },
      )
      // Registered before /api/emails/:id so that "wait" is not taken for an id.
      .get(
        '/api/emails/wait',
        ({ query, request }) =>
          service.waitForEmail({
            ...parseWait(query),
            filter: parseFilter(query),
            signal: request.signal,
          }),
        {
          detail: {
            tags: ['Emails'],
            summary: 'Wait for an email',
            description: `Returns the matching email with the lowest id above afterId, waiting up to timeoutMs for one to arrive. A timeout returns data null and timedOut true. Use the returned email's id as the next afterId, or highWatermark after a timeout. ${FILTER_DESCRIPTION}`,
          },
          query: t.Object({
            ...filterQuery,
            afterId: t.String({
              description:
                'Cursor: an id from this mailbox (0 for the first email), e.g. highWatermark of a list response',
            }),
            mailboxId: t.Optional(
              t.String({
                description:
                  'mailboxId of the response the cursor came from; a different mailbox is rejected with INVALID_CURSOR',
              }),
            ),
            timeoutMs: t.Optional(
              t.String({ description: '0 to 60000, default 30000' }),
            ),
          }),
          response: { 400: errorSchema, 429: errorSchema },
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
      .get(
        '/api/emails/:id/raw',
        ({ params }) => {
          const id = parseId(params.id);
          const raw = service.getRaw(id);
          if (!raw) throw emailNotFound();
          return download(raw, 'message/rfc822', `email-${id}.eml`);
        },
        {
          detail: {
            tags: ['Emails'],
            summary: 'Download the message source',
            description:
              'Returns the exact bytes the SMTP client sent, as an .eml download.',
          },
          params: t.Object({ id: t.String() }),
        },
      )
      .get(
        '/api/emails/:id/attachments/:index',
        ({ params }) => {
          const index = parseIndex(params.index);
          const attachment = service.getAttachment(parseId(params.id), index);
          return download(
            attachment.bytes,
            safeContentType(attachment.contentType),
            attachment.filename ?? `attachment-${index}`,
          );
        },
        {
          detail: {
            tags: ['Emails'],
            summary: 'Download an attachment',
            description:
              'Returns the decoded attachment with the given zero-based index. Types that browsers could execute (HTML, XML, SVG, scripts, CSS) are served as application/octet-stream; the declared type is in the email details.',
          },
          params: t.Object({ id: t.String(), index: t.String() }),
        },
      )
      .delete(
        '/api/emails/:id',
        ({ params }) => {
          if (!service.delete(parseId(params.id), 'rest'))
            throw emailNotFound();
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
            'Deletes all caught emails and returns the count of deleted emails. Ids are never reused.',
        },
      })
  );
}

/** A download response for captured, untrusted content. */
function download(
  bytes: Uint8Array,
  contentType: string,
  filename: string,
): Response {
  return new Response(bytes, {
    headers: {
      'content-type': contentType,
      'content-disposition': contentDisposition(filename),
      'content-security-policy': 'sandbox',
      'cache-control': 'no-store',
    },
  });
}

/** The declared type when browsers cannot execute it, else octet-stream. */
export function safeContentType(declared: string): string {
  const type = declared.split(';', 1)[0].trim().toLowerCase();
  const inert =
    /^[a-z\d][\w.+-]*\/[a-z\d][\w.+-]*$/.test(type) &&
    !/html|xml|script|css/.test(type);
  return inert ? type : 'application/octet-stream';
}

/**
 * An RFC 6266 attachment disposition: an ASCII fallback name plus the
 * exact UTF-8 name (RFC 8187). Names are capped at 200 characters.
 */
export function contentDisposition(filename: string): string {
  const name = filename.slice(0, 200).replaceAll(/\p{Cs}/gu, '_');
  const fallback = name.replaceAll(/[^\u{20}-\u{7E}]|["\\]/gu, '_');
  const encoded = encodeURIComponent(name).replaceAll(
    /['()*]/g,
    (char) => `%${char.codePointAt(0)?.toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
