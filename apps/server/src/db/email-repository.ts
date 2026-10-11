import type { Database, SqlValue } from 'sql.js';
import type {
  AttachmentMeta,
  Email,
  EmailSummary,
  SmtpEnvelope,
} from '@mail-debugger/types';
import type { FilterClause } from './email-query.js';
import { readMetadata, type StoreMetadata } from './metadata.js';
import {
  firstRow,
  rowsFrom,
  rowToEmail,
  rowToSummary,
  SUMMARY_COLUMNS,
} from './row-mapper.js';
import { META_KEYS } from './schema.js';

/** A parsed message ready to be stored. */
export interface NewEmail {
  messageId: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  /** Exact message octets as received. */
  raw: Uint8Array;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
  envelope: SmtpEnvelope | null;
  /** UTC ISO 8601 timestamp with milliseconds. */
  receivedAt: string;
  /** Bytes counted against the storage limit. */
  sizeBytes: number;
}

/** The identifiers of a stored email. */
export interface EmailKey {
  id: number;
  uid: number;
}

export interface StoreStats {
  count: number;
  bytes: number;
}

/**
 * SQL access to the canonical mailbox. Methods are synchronous; mutations
 * that must be atomic run inside {@link EmailRepository.transaction}.
 */
export class EmailRepository {
  constructor(private readonly db: Database) {}

  /** Runs `fn` in a transaction and rolls it back if `fn` throws. */
  transaction<T>(fn: () => T): T {
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  metadata(): StoreMetadata {
    return readMetadata(this.db);
  }

  /**
   * Allocates the next id and IMAP UID and stores the email. Call it inside
   * a transaction so the allocation and the row commit together.
   */
  insert(email: NewEmail): EmailKey {
    const meta = readMetadata(this.db);
    const key = { id: meta.lastId + 1, uid: meta.uidNext };
    this.db.run(
      `INSERT INTO emails (
        id, uid, message_id, from_addr, to_addr, cc, bcc, subject, text_body,
        html_body, raw, headers, attachments, envelope_from, envelope_to,
        flags, size_bytes, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      [
        key.id,
        key.uid,
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
        email.envelope?.from ?? null,
        email.envelope ? JSON.stringify(email.envelope.to) : null,
        email.sizeBytes,
        email.receivedAt,
      ],
    );
    this.setMeta(META_KEYS.lastId, key.id);
    this.setMeta(META_KEYS.uidNext, key.uid + 1);
    return key;
  }

  /** Summaries matching `clause`, newest first. */
  list(clause: FilterClause, limit: number, offset: number): EmailSummary[] {
    const rows = rowsFrom(
      this.db.exec(
        `SELECT ${SUMMARY_COLUMNS} FROM emails ${clause.where}
         ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...clause.params, limit, offset],
      ),
    );
    return rows.map((row) => rowToSummary(row));
  }

  count(clause?: FilterClause): number {
    const row = firstRow(
      this.db.exec(
        `SELECT count(*) AS total FROM emails ${clause?.where ?? ''}`,
        clause?.params ?? [],
      ),
    );
    return Number(row?.['total'] ?? 0);
  }

  stats(): StoreStats {
    const row = firstRow(
      this.db.exec(
        'SELECT count(*) AS count, coalesce(sum(size_bytes), 0) AS bytes FROM emails',
      ),
    );
    return { count: Number(row?.['count']), bytes: Number(row?.['bytes']) };
  }

  findById(id: number): Email | undefined {
    const row = firstRow(
      this.db.exec('SELECT * FROM emails WHERE id = ?', [id]),
    );
    return row ? rowToEmail(row) : undefined;
  }

  /** The exact message octets, or undefined for an unknown id. */
  findRaw(id: number): Uint8Array | undefined {
    const row = firstRow(
      this.db.exec('SELECT raw FROM emails WHERE id = ?', [id]),
    );
    return row ? (row['raw'] as Uint8Array) : undefined;
  }

  findKey(id: number): EmailKey | undefined {
    const row = firstRow(
      this.db.exec('SELECT id, uid FROM emails WHERE id = ?', [id]),
    );
    return row ? toKey(row) : undefined;
  }

  /** Keys of the emails with the given ids that exist, in ascending id order. */
  findKeys(ids: readonly number[]): EmailKey[] {
    if (ids.length === 0) return [];
    const rows = rowsFrom(
      this.db.exec(
        `SELECT id, uid FROM emails WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`,
        [...ids],
      ),
    );
    return rows.map((row) => toKey(row));
  }

  allKeys(): EmailKey[] {
    return rowsFrom(this.db.exec('SELECT id, uid FROM emails ORDER BY id')).map(
      (row) => toKey(row),
    );
  }

  /** Deletes the emails with the given ids; returns the keys that existed. */
  deleteByIds(ids: readonly number[]): EmailKey[] {
    const keys = this.findKeys(ids);
    for (const key of keys) {
      this.db.run('DELETE FROM emails WHERE id = ?', [key.id]);
    }
    return keys;
  }

  deleteAll(): EmailKey[] {
    const keys = this.allKeys();
    this.db.run('DELETE FROM emails');
    return keys;
  }

  getFlags(id: number): string[] | undefined {
    const row = firstRow(
      this.db.exec('SELECT flags FROM emails WHERE id = ?', [id]),
    );
    return row ? (JSON.parse(String(row['flags'])) as string[]) : undefined;
  }

  /** Replaces the IMAP flags of an email; returns false for an unknown id. */
  setFlags(id: number, flags: readonly string[]): boolean {
    this.db.run('UPDATE emails SET flags = ? WHERE id = ?', [
      JSON.stringify(flags),
      id,
    ]);
    return this.db.getRowsModified() > 0;
  }

  setInboxSubscribed(subscribed: boolean): void {
    this.setMeta(META_KEYS.inboxSubscribed, subscribed ? 1 : 0);
  }

  private setMeta(key: string, value: number): void {
    this.db.run('UPDATE meta SET value = ? WHERE key = ?', [
      String(value),
      key,
    ] satisfies SqlValue[]);
  }
}

function toKey(row: Record<string, SqlValue>): EmailKey {
  return { id: Number(row['id']), uid: Number(row['uid']) };
}
