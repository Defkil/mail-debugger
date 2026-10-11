import * as z from 'zod';
import { MAX_FILTER_LENGTH } from '../db/email-query.js';

/** Largest serialized result of one tool call. */
export const MAX_RESULT_BYTES = 1024 * 1024;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_BODY_BYTES = 64 * 1024;
export const MAX_WAIT_MS = 30_000;
export const DEFAULT_WAIT_MS = 10_000;
export const MAX_ATTACHMENT_CHUNK = 64 * 1024;

const emailId = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)
  .describe('Id of an email, as listed by list_emails');
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(MAX_FILTER_LENGTH);
const dateBound = z
  .string()
  .max(64)
  .describe('YYYY-MM-DD (the whole UTC day) or an ISO 8601 date-time');

export const filterSchema = z
  .strictObject({
    from: text
      .optional()
      .describe('Case-insensitive substring of the From address'),
    to: text.optional().describe('Case-insensitive substring of a To address'),
    subject: text
      .optional()
      .describe('Case-insensitive substring of the subject'),
    since: dateBound.optional().describe('Received at or after (inclusive)'),
    until: dateBound.optional().describe('Received at or before (inclusive)'),
  })
  .describe('Every given criterion must match');

const page = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
    .describe(`Most emails to return, 1 to ${MAX_LIST_LIMIT}`),
  offset: count.default(0).describe('Emails to skip, newest first'),
};

export const listInput = z.strictObject(page);

export const searchInput = z.strictObject({
  filter: filterSchema.refine(
    (filter) => Object.values(filter).some((value) => value !== undefined),
    'Give at least one filter criterion',
  ),
  ...page,
});

export const getEmailInput = z.strictObject({
  id: emailId,
  body: z
    .enum(['none', 'text', 'html'])
    .default('text')
    .describe('Which body to return; html is the raw, untrusted markup'),
  includeHeaders: z
    .boolean()
    .default(true)
    .describe('Include the decoded header fields'),
  maxBodyBytes: z
    .number()
    .int()
    .min(0)
    .max(MAX_BODY_BYTES)
    .default(DEFAULT_BODY_BYTES)
    .describe('Longest body to return, in UTF-8 bytes'),
});

export const waitInput = z.strictObject({
  afterId: count
    .optional()
    .describe(
      'Cursor: return the first matching email with a higher id, e.g. highWatermark of an earlier result. Without it, wait for mail that arrives after the call.',
    ),
  mailboxId: z
    .string()
    .max(64)
    .optional()
    .describe('mailboxId of the result the cursor came from'),
  filter: filterSchema.optional(),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_MS)
    .default(DEFAULT_WAIT_MS)
    .describe(`How long to wait, 0 to ${MAX_WAIT_MS} ms`),
});

export const attachmentsInput = z.strictObject({ id: emailId });

export const attachmentInput = z.strictObject({
  id: emailId,
  index: count.describe('Zero-based attachment index'),
  offset: count.default(0).describe('First byte to return'),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_ATTACHMENT_CHUNK)
    .default(MAX_ATTACHMENT_CHUNK)
    .describe('Most bytes to return'),
});

export const deleteInput = z.strictObject({
  id: emailId,
  confirm: z.literal(true).describe('Must be true'),
});

export const clearInput = z.strictObject({
  confirm: z.literal(true).describe('Must be true'),
  expectedCount: count.describe(
    'The number of emails the caller expects to delete (total of list_emails); a different count deletes nothing',
  ),
});

export const summarySchema = z.strictObject({
  id: z.number().int(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  receivedAt: z.string(),
  hasAttachments: z.boolean(),
  truncated: z
    .boolean()
    .optional()
    .describe('Set when long fields were shortened'),
});

const cursor = {
  highWatermark: count.describe('Highest email id allocated so far'),
  mailboxId: z.string().describe('Identity of the mailbox data set'),
};

export const listOutput = z.strictObject({
  data: z.array(summarySchema),
  total: count,
  ...cursor,
});

export const attachmentMetaSchema = z.strictObject({
  index: count,
  filename: z.string().nullable(),
  size: count,
  contentType: z.string(),
});

export const emailOutput = z.strictObject({
  id: z.number().int(),
  messageId: z.string().nullable(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  receivedAt: z.string(),
  envelope: z
    .strictObject({ from: z.string().nullable(), to: z.array(z.string()) })
    .nullable(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.strictObject({
    format: z.enum(['none', 'text', 'html']),
    content: z.string().nullable(),
    bytes: count.describe('UTF-8 size of the whole body'),
    truncated: z.boolean(),
  }),
  attachments: z.array(attachmentMetaSchema),
  truncated: z
    .boolean()
    .describe(
      'Set when headers, addresses or the attachment list were shortened',
    ),
});

export const waitOutput = z.strictObject({
  email: summarySchema.nullable(),
  timedOut: z.boolean(),
  ...cursor,
});

export const attachmentsOutput = z.strictObject({
  emailId: z.number().int(),
  attachments: z.array(attachmentMetaSchema),
  total: count,
  truncated: z.boolean(),
});

export const attachmentOutput = z.strictObject({
  emailId: z.number().int(),
  index: count,
  filename: z.string().nullable(),
  contentType: z.string(),
  size: count,
  offset: count,
  dataBase64: z.string(),
  nextOffset: count.nullable().describe('Offset of the next chunk, or null'),
  truncated: z.boolean().describe('More bytes follow'),
});

export const deleteOutput = z.strictObject({
  deleted: z.literal(true),
  id: z.number().int(),
});

export const clearOutput = z.strictObject({ deleted: count });

/** Stable codes of failed tool calls. */
export type ToolErrorCode =
  | 'EMAIL_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'INVALID_CURSOR'
  | 'COUNT_CHANGED'
  | 'LIMIT_EXCEEDED'
  | 'SHUTTING_DOWN'
  | 'SERVER_UNAVAILABLE'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';
