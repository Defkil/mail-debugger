/** An attachment as the server parsed it. */
export interface AttachmentMeta {
  /** File name from the MIME headers, if the sender set one. */
  filename: string | null;
  /** Decoded size in bytes. */
  size: number;
  /** MIME type the sender declared, e.g. `application/pdf`. */
  contentType: string;
  /** Decoded content, base64-encoded. */
  content: string;
}

/** The SMTP envelope: who the client sent the message from and to. */
export interface SmtpEnvelope {
  /** `MAIL FROM` address, `null` for an empty reverse path (bounces). */
  from: string | null;
  /** `RCPT TO` addresses, including Bcc recipients that no header names. */
  to: string[];
}

/** The parsed fields of an email. */
export interface ParsedEmail {
  /** Value of the `Message-ID` header, including angle brackets. */
  messageId: string | null;
  /** Sender address from the `From` header. */
  from: string;
  /** Addresses from the `To` header. */
  to: string[];
  /** Addresses from the `Cc` header. */
  cc: string[];
  /** Addresses from a `Bcc` header, if the message contains one. */
  bcc: string[];
  subject: string;
  /** Plain text body, if the email has one. */
  textBody: string | null;
  /** HTML body, if the email has one. Treat it as untrusted content. */
  htmlBody: string | null;
  /**
   * Message source decoded as UTF-8, kept for compatibility. Use
   * `getRawEmail()` for the exact bytes.
   */
  raw: string;
  /** Decoded header values keyed by lower-case header name. */
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

/** A caught email with all details. */
export interface Email extends ParsedEmail {
  /** Server-assigned id; ids only grow and are never reused. */
  id: number;
  /** Time the server received the email, UTC ISO 8601 with milliseconds. */
  receivedAt: string;
  /** SMTP envelope; absent for messages stored before mail-debugger 0.4. */
  envelope?: SmtpEnvelope;
}

/** The fields of a caught email shown in lists. */
export interface EmailSummary {
  id: number;
  from: string;
  to: string[];
  subject: string;
  /** Time the server received the email, UTC ISO 8601 with milliseconds. */
  receivedAt: string;
  hasAttachments: boolean;
}

/**
 * Narrows a list of emails; every given criterion must match. `from`, `to`
 * and `subject` are literal, case-insensitive substrings; `since` and
 * `until` are inclusive UTC bounds (`YYYY-MM-DD` covers the whole day).
 */
export interface EmailFilter {
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  until?: string;
}

export interface HealthResponse {
  status: 'ok';
  /** Version of the running mail-debugger (0.4 and later). */
  version?: string;
  smtpPort: number;
  apiPort: number;
  persistent: boolean;
  emailCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  /** Number of matches, ignoring `limit` and `offset`. */
  total: number;
}

/** A page of email summaries, newest first. */
export interface EmailPage extends PaginatedResponse<EmailSummary> {
  /** Highest email id ever allocated; a cursor for `waitForEmail` (0.4 and later). */
  highWatermark?: number;
  /** Identity of the server's mailbox data set (0.4 and later). */
  mailboxId?: string;
}

/** Parameters of `waitForEmail`. */
export interface WaitForEmailParams {
  /**
   * Cursor: the result is the lowest matching email with an id above it.
   * Use `highWatermark` of a list or wait result, or 0 for any email.
   */
  afterId: number;
  /** Rejects the wait when the server's mailbox is another data set. */
  mailboxId?: string;
  filter?: EmailFilter;
  /** How long the server waits, 0 to 60 000 ms (default 30 000). */
  timeoutMs?: number;
}

export interface WaitResult {
  /** The first matching email, or null when the wait timed out. */
  data: EmailSummary | null;
  timedOut: boolean;
  /** Highest email id allocated when the wait ended. */
  highWatermark: number;
  mailboxId: string;
}

/** A downloaded attachment. */
export interface AttachmentDownload {
  bytes: Uint8Array;
  filename: string | null;
  contentType: string;
}
