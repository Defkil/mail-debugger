import type { QueryExecResult, SqlValue } from 'sql.js';
import type { Email, EmailSummary } from '@mail-debugger/types';

export type Row = Record<string, SqlValue>;

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

export function rowToSummary(row: Row): EmailSummary {
  const attachments = row['attachments'] as string | null;
  return {
    id: row['id'] as number,
    from: row['from_addr'] as string,
    to: JSON.parse(row['to_addr'] as string) as string[],
    subject: row['subject'] as string,
    receivedAt: row['received_at'] as string,
    hasAttachments:
      attachments !== null && (JSON.parse(attachments) as unknown[]).length > 0,
  };
}

export function rowToEmail(row: Row): Email {
  return {
    id: row['id'] as number,
    messageId: row['message_id'] as string | null,
    from: row['from_addr'] as string,
    to: JSON.parse(row['to_addr'] as string) as string[],
    cc: row['cc'] ? (JSON.parse(row['cc'] as string) as string[]) : [],
    bcc: row['bcc'] ? (JSON.parse(row['bcc'] as string) as string[]) : [],
    subject: row['subject'] as string,
    textBody: row['text_body'] as string | null,
    htmlBody: row['html_body'] as string | null,
    raw: row['raw'] as string,
    headers: row['headers']
      ? (JSON.parse(row['headers'] as string) as Record<string, string>)
      : {},
    attachments: row['attachments']
      ? (JSON.parse(row['attachments'] as string) as Email['attachments'])
      : [],
    receivedAt: row['received_at'] as string,
  };
}
