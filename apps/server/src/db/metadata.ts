import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import { firstRow, rowsFrom } from './row-mapper.js';
import { META_KEYS } from './schema.js';

/** Identity and counters of a mailbox data set. */
export interface StoreMetadata {
  /** Random identity of the data set; cursors of another data set are rejected. */
  mailboxId: string;
  /** IMAP UIDVALIDITY of the INBOX. */
  uidValidity: number;
  /** Highest email id ever allocated (the cursor high watermark). */
  lastId: number;
  /** Next IMAP UID. */
  uidNext: number;
  /** Whether the INBOX is subscribed over IMAP. */
  inboxSubscribed: boolean;
}

/** Identity of a new data set; ids and UIDs continue after `lastId`. */
export function newMetadata({ lastId }: { lastId: number }): StoreMetadata {
  return {
    mailboxId: randomUUID(),
    // RFC 3501 UIDVALIDITY is a non-zero 32-bit number; seconds since the
    // epoch fit until 2106 and differ between data sets.
    uidValidity: Math.max(1, Math.floor(Date.now() / 1000) % 0xff_ff_ff_ff),
    lastId,
    uidNext: lastId + 1,
    inboxSubscribed: true,
  };
}

export function writeMetadata(db: Database, meta: StoreMetadata): void {
  const entries: [string, string][] = [
    [META_KEYS.mailboxId, meta.mailboxId],
    [META_KEYS.uidValidity, String(meta.uidValidity)],
    [META_KEYS.lastId, String(meta.lastId)],
    [META_KEYS.uidNext, String(meta.uidNext)],
    [META_KEYS.inboxSubscribed, meta.inboxSubscribed ? '1' : '0'],
  ];
  for (const [key, value] of entries) {
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }
}

export function readMetadata(db: Database): StoreMetadata {
  const values = new Map(
    rowsFrom(db.exec('SELECT key, value FROM meta')).map((row) => [
      String(row['key']),
      String(row['value']),
    ]),
  );
  const get = (key: string) => {
    const value = values.get(key);
    if (value === undefined) {
      throw new Error(`The storage metadata misses "${key}"`);
    }
    return value;
  };
  return {
    mailboxId: get(META_KEYS.mailboxId),
    uidValidity: Number(get(META_KEYS.uidValidity)),
    lastId: Number(get(META_KEYS.lastId)),
    uidNext: Number(get(META_KEYS.uidNext)),
    inboxSubscribed: get(META_KEYS.inboxSubscribed) === '1',
  };
}

export function hasTable(db: Database, name: string): boolean {
  return (
    firstRow(
      db.exec(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
        [name],
      ),
    )?.['n'] === 1
  );
}
