import type Database from 'better-sqlite3';
import type {
  ParsedEmail,
  Email,
  EmailSummary,
  EmailFilter,
} from '../types.js';

export class EmailRepository {
  constructor(private db: Database.Database) {}

  insert(email: ParsedEmail): number {
    const stmt = this.db.prepare(`
      INSERT INTO emails (message_id, from_addr, to_addr, cc, bcc, subject, text_body, html_body, raw, headers, attachments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
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
      JSON.stringify(email.attachments)
    );

    return result.lastInsertRowid as number;
  }

  findAll(
    filter?: EmailFilter,
    limit?: number,
    offset?: number
  ): { data: EmailSummary[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

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

    const { total } = this.db
      .prepare(`SELECT count(*) as total FROM emails ${where}`)
      .get(...params) as { total: number };

    let sql = `SELECT id, from_addr, to_addr, subject, received_at, attachments FROM emails ${where} ORDER BY received_at DESC`;
    if (limit != null) {
      sql += ` LIMIT ${limit}`;
      if (offset != null) sql += ` OFFSET ${offset}`;
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      from_addr: string;
      to_addr: string;
      subject: string;
      received_at: string;
      attachments: string | null;
    }>;

    return {
      total,
      data: rows.map((row) => ({
        id: row.id,
        from: row.from_addr,
        to: JSON.parse(row.to_addr) as string[],
        subject: row.subject,
        receivedAt: row.received_at,
        hasAttachments:
          row.attachments !== null &&
          (JSON.parse(row.attachments) as unknown[]).length > 0,
      })),
    };
  }

  findById(id: number): Email | undefined {
    const row = this.db
      .prepare('SELECT * FROM emails WHERE id = ?')
      .get(id) as
      | {
          id: number;
          message_id: string | null;
          from_addr: string;
          to_addr: string;
          cc: string | null;
          bcc: string | null;
          subject: string;
          text_body: string | null;
          html_body: string | null;
          raw: string;
          headers: string | null;
          attachments: string | null;
          received_at: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      messageId: row.message_id,
      from: row.from_addr,
      to: JSON.parse(row.to_addr),
      cc: row.cc ? JSON.parse(row.cc) : [],
      bcc: row.bcc ? JSON.parse(row.bcc) : [],
      subject: row.subject,
      textBody: row.text_body,
      htmlBody: row.html_body,
      raw: row.raw,
      headers: row.headers ? JSON.parse(row.headers) : {},
      attachments: row.attachments ? JSON.parse(row.attachments) : [],
      receivedAt: row.received_at,
    };
  }

  deleteById(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM emails WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  deleteAll(): number {
    const result = this.db.prepare('DELETE FROM emails').run();
    return result.changes;
  }

  count(): number {
    const row = this.db
      .prepare('SELECT count(*) as count FROM emails')
      .get() as { count: number };
    return row.count;
  }
}
