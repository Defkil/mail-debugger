import type { Database } from 'sql.js';
import type {
  Email,
  EmailFilter,
  EmailSummary,
  ParsedEmail,
} from '@mail-debugger/types';
import { firstRow, rowsFrom, rowToEmail, rowToSummary } from './row-mapper.js';
import { buildFilterClause } from './email-query.js';

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
    const { where, params } = buildFilterClause(filter);

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
      data: rows.map((row) => rowToSummary(row)),
    };
  }

  findById(id: number): Email | undefined {
    const row = firstRow(
      this.db.exec('SELECT * FROM emails WHERE id = ?', [id]),
    );
    return row ? rowToEmail(row) : undefined;
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
