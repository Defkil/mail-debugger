export interface AttachmentMeta {
  filename: string | null;
  size: number;
  contentType: string;
  content: string; // base64
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
  raw: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

export interface Email extends ParsedEmail {
  id: number;
  receivedAt: string;
}

export interface EmailSummary {
  id: number;
  from: string;
  to: string[];
  subject: string;
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
  smtpPort: number;
  apiPort: number;
  persistent: boolean;
  emailCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}
