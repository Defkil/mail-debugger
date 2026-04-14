import type { Database, SqlValue, QueryExecResult } from 'sql.js';
import type {
  ParsedEmail,
  Email,
  EmailSummary,
  EmailFilter,
} from '@mail-debugger/types';

type Row = Record<string, SqlValue>;

function rowsFrom(result: QueryExecResult[]): Row[] {
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

function firstRow(result: QueryExecResult[]): Row | undefined {
  const rows = rowsFrom(result);
  return rows[0];
}

export class EmailRepository {
  constructor(private db: Database) {}

  insert(email: ParsedEmail): number {
    this.db.run(
      `
      INSERT INTO emails (message_id, from_addr, to_addr, cc, bcc, subject, text_body, html_body, raw, headers, attachments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        email.messageId,
        email.from,
        JSON.stringify(email.to),
        JSON.stringify(email.cc),
        JSON.stringify(email.bcc),
        email.subject,
        email.textBody,
        email.htmlBody,
        email.raw,
        JSON.stringify(email.headers),
        JSON.stringify(email.attachments),
      ],
    );
    const row = firstRow(this.db.exec('SELECT last_insert_rowid() AS id'));
    return row?.['id'] as number;
  }

  findAll(
    filter?: EmailFilter,
    limit?: number,
    offset?: number,
  ): { data: EmailSummary[]; total: number } {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (filter?.from) {
      conditions.push('from_addr LIKE ?');
      params.push(`%${filter.from}%`);
    }
    if (filter?.to) {
      conditions.push('to_addr LIKE ?');
      params.push(`%${filter.to}%`);
    }
    if (filter?.subject) {
      conditions.push('subject LIKE ?');
      params.push(`%${filter.subject}%`);
    }
    if (filter?.since) {
      conditions.push('received_at >= ?');
      params.push(filter.since);
    }
    if (filter?.until) {
      conditions.push('received_at <= ?');
      params.push(filter.until);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = firstRow(
      this.db.exec(`SELECT count(*) AS total FROM emails ${where}`, params),
    );
    const total = (countRow?.['total'] as number) ?? 0;

    let sql = `SELECT id, from_addr, to_addr, subject, received_at, attachments FROM emails ${where} ORDER BY received_at DESC`;
    if (limit != null) {
      sql += ` LIMIT ${limit}`;
      if (offset != null) sql += ` OFFSET ${offset}`;
    }

    const rows = rowsFrom(this.db.exec(sql, params));
    return {
      total,
      data: rows.map((row) => {
        const attachments = row['attachments'] as string | null;
        return {
          id: row['id'] as number,
          from: row['from_addr'] as string,
          to: JSON.parse(row['to_addr'] as string) as string[],
          subject: row['subject'] as string,
          receivedAt: row['received_at'] as string,
          hasAttachments:
            attachments !== null &&
            (JSON.parse(attachments) as unknown[]).length > 0,
        };
      }),
    };
  }

  findById(id: number): Email | undefined {
    const row = firstRow(
      this.db.exec('SELECT * FROM emails WHERE id = ?', [id]),
    );
    if (!row) return undefined;
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

  deleteById(id: number): boolean {
    this.db.run('DELETE FROM emails WHERE id = ?', [id]);
    return this.db.getRowsModified() > 0;
  }

  deleteAll(): number {
    this.db.run('DELETE FROM emails');
    return this.db.getRowsModified();
  }

  count(): number {
    const row = firstRow(this.db.exec('SELECT count(*) AS count FROM emails'));
    return (row?.['count'] as number) ?? 0;
  }
}
