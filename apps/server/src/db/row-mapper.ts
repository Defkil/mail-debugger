import type { QueryExecResult, SqlValue } from 'sql.js';
import type { AttachmentMeta, Email, EmailSummary } from '@mail-debugger/types';

export type Row = Record<string, SqlValue>;

const utf8 = new TextDecoder('utf-8');

export function rowsFrom(result: QueryExecResult[]): Row[] {
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((vals) => {
    const row: Row = {};
    for (const [i, col] of columns.entries()) {
      row[col] = vals[i];
    }
    return row;
  });
}

export function firstRow(result: QueryExecResult[]): Row | undefined {
  return rowsFrom(result)[0];
}

/** Columns of an {@link EmailSummary} row. */
export const SUMMARY_COLUMNS =
  "id, from_addr, to_addr, subject, received_at, attachments <> '[]' AS has_attachments";

export function rowToSummary(row: Row): EmailSummary {
  return {
    id: Number(row['id']),
    from: String(row['from_addr']),
    to: parseJson<string[]>(row['to_addr'], []),
    subject: String(row['subject']),
    receivedAt: String(row['received_at']),
    hasAttachments: Number(row['has_attachments']) === 1,
  };
}

export function rowToEmail(row: Row): Email {
  const envelopeTo = row['envelope_to'];
  return {
    id: Number(row['id']),
    messageId: (row['message_id'] as string | null) ?? null,
    from: String(row['from_addr']),
    to: parseJson<string[]>(row['to_addr'], []),
    cc: parseJson<string[]>(row['cc'], []),
    bcc: parseJson<string[]>(row['bcc'], []),
    subject: String(row['subject']),
    textBody: (row['text_body'] as string | null) ?? null,
    htmlBody: (row['html_body'] as string | null) ?? null,
    // Kept as a string for compatibility; GET /api/emails/:id/raw serves the bytes.
    raw: utf8.decode(row['raw'] as Uint8Array),
    headers: parseJson<Record<string, string>>(row['headers'], {}),
    attachments: parseJson<AttachmentMeta[]>(row['attachments'], []),
    receivedAt: String(row['received_at']),
    ...(typeof envelopeTo === 'string' && {
      envelope: {
        from: (row['envelope_from'] as string | null) ?? null,
        to: parseJson<string[]>(envelopeTo, []),
      },
    }),
  };
}

function parseJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
