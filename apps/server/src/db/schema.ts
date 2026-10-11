/**
 * Storage schema. `PRAGMA user_version` holds the schema version: 0 for the
 * unversioned 0.3.x layout (see migrations.ts), {@link SCHEMA_VERSION} for
 * the current one.
 */
export const SCHEMA_VERSION = 2;

/** Keys of the `meta` table. */
export const META_KEYS = {
  /** Random identity of this mailbox data set, part of every cursor. */
  mailboxId: 'mailbox_id',
  /** IMAP UIDVALIDITY of the INBOX; changes only with a new data set. */
  uidValidity: 'uid_validity',
  /** Last email id ever allocated; ids are never reused, not even after clear. */
  lastId: 'last_id',
  /** Next IMAP UID to allocate; never decreases. */
  uidNext: 'uid_next',
  /** Whether the INBOX is subscribed over IMAP ("1" or "0"). */
  inboxSubscribed: 'inbox_subscribed',
} as const;

export const CREATE_SCHEMA = [
  `CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE emails (
    id            INTEGER PRIMARY KEY,
    uid           INTEGER NOT NULL UNIQUE,
    message_id    TEXT,
    from_addr     TEXT NOT NULL,
    to_addr       TEXT NOT NULL,
    cc            TEXT NOT NULL,
    bcc           TEXT NOT NULL,
    subject       TEXT NOT NULL,
    text_body     TEXT,
    html_body     TEXT,
    raw           BLOB NOT NULL,
    headers       TEXT NOT NULL,
    attachments   TEXT NOT NULL,
    envelope_from TEXT,
    envelope_to   TEXT,
    flags         TEXT NOT NULL DEFAULT '[]',
    size_bytes    INTEGER NOT NULL,
    received_at   TEXT NOT NULL
  )`,
  'CREATE INDEX idx_emails_received ON emails (received_at DESC, id DESC)',
];
