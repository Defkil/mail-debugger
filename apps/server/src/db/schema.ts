export const CREATE_EMAILS_TABLE = `
CREATE TABLE IF NOT EXISTS emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT,
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  cc          TEXT,
  bcc         TEXT,
  subject     TEXT,
  text_body   TEXT,
  html_body   TEXT,
  raw         TEXT NOT NULL,
  headers     TEXT,
  attachments TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_addr)',
  'CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject)',
  'CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at)',
];
