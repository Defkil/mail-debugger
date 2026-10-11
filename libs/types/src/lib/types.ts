export interface AttachmentMeta {
  filename: string | null;
  size: number;
  contentType: string;
  content: string; // base64
}

/** The SMTP envelope: who the client sent the message from and to. */
export interface SmtpEnvelope {
  /** `MAIL FROM` address, `null` for an empty reverse path (bounces). */
  from: string | null;
  /** `RCPT TO` addresses, including Bcc recipients that no header names. */
  to: string[];
}

export interface ParsedEmail {
  messageId: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  /** Message source decoded as UTF-8; the raw route serves the exact bytes. */
  raw: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

export interface Email extends ParsedEmail {
  id: number;
  /** UTC ISO 8601 timestamp with milliseconds. */
  receivedAt: string;
  /** SMTP envelope; absent for messages stored before mail-debugger 0.4. */
  envelope?: SmtpEnvelope;
}

export interface EmailSummary {
  id: number;
  from: string;
  to: string[];
  subject: string;
  /** UTC ISO 8601 timestamp with milliseconds. */
  receivedAt: string;
  hasAttachments: boolean;
}

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
  total: number;
}
