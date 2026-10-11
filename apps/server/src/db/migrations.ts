import type { Database, SqlValue } from 'sql.js';
import { hasTable, newMetadata, writeMetadata } from './metadata.js';
import { firstRow, rowsFrom, type Row } from './row-mapper.js';
import { CREATE_SCHEMA, SCHEMA_VERSION } from './schema.js';
import { storedSize } from './sizes.js';

const textEncoder = new TextEncoder();

/**
 * Migrates the unversioned 0.3.x layout to the current schema in one
 * transaction:
 *
 * - `raw` was stored as decoded UTF-8 text; it becomes the UTF-8 bytes of
 *   that text. Bytes that 0.3.x could not decode are lost for good.
 * - `received_at` (SQLite `datetime('now')`, UTC) becomes ISO 8601 with
 *   milliseconds.
 * - Ids keep their values and become the IMAP UIDs; the id counter continues
 *   after the highest id ever allocated (AUTOINCREMENT kept it in
 *   `sqlite_sequence`), so cursors never rewind.
 *
 * Returns the number of migrated messages.
 */
export function migrateFromLegacy(db: Database): number {
  const rows = rowsFrom(db.exec('SELECT * FROM emails ORDER BY id'));
  const sequence = hasTable(db, 'sqlite_sequence')
    ? firstRow(db.exec("SELECT seq FROM sqlite_sequence WHERE name = 'emails'"))
    : undefined;
  const lastId = Math.max(
    0,
    Number(sequence?.['seq'] ?? 0),
    ...rows.map((row) => Number(row['id'])),
  );

  db.run('BEGIN');
  try {
    db.run('ALTER TABLE emails RENAME TO emails_v1');
    for (const statement of CREATE_SCHEMA) db.run(statement);
    for (const row of rows) db.run(INSERT_MIGRATED, migratedValues(row));
    db.run('DROP TABLE emails_v1');
    writeMetadata(db, newMetadata({ lastId }));
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return rows.length;
}

const INSERT_MIGRATED = `
  INSERT INTO emails (
    id, uid, message_id, from_addr, to_addr, cc, bcc, subject, text_body,
    html_body, raw, headers, attachments, envelope_from, envelope_to, flags,
    size_bytes, received_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?)`;

function migratedValues(row: Row): SqlValue[] {
  const raw = textEncoder.encode(stringOr(row['raw'], ''));
  const textBody = stringOrNull(row['text_body']);
  const htmlBody = stringOrNull(row['html_body']);
  const attachments = stringOr(row['attachments'], '[]');
  const id = Number(row['id']);
  return [
    id,
    id,
    stringOrNull(row['message_id']),
    stringOr(row['from_addr'], ''),
    stringOr(row['to_addr'], '[]'),
    stringOr(row['cc'], '[]'),
    stringOr(row['bcc'], '[]'),
    stringOr(row['subject'], ''),
    textBody,
    htmlBody,
    raw,
    stringOr(row['headers'], '{}'),
    attachments,
    storedSize({
      raw,
      textBody,
      htmlBody,
      attachmentSizes: attachmentSizes(attachments),
    }),
    legacyTimestamp(stringOr(row['received_at'], '')),
  ];
}

function stringOr(value: SqlValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: SqlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function attachmentSizes(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as { size?: unknown }[];
    return parsed.map((attachment) =>
      typeof attachment.size === 'number' ? attachment.size : 0,
    );
  } catch {
    return [];
  }
}

/** `2026-01-31 12:00:00` (UTC, as SQLite wrote it) to `2026-01-31T12:00:00.000Z`. */
export function legacyTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?Z?$/.exec(
    value,
  );
  const parsed = new Date(
    match ? `${match[1]}T${match[2]}${match[3] ?? ''}Z` : value,
  );
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}
