export interface AttachmentMeta {
  filename: string | null;
  size: number;
  contentType: string;
  content: string;
}

export interface Email {
  id: number;
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

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

export interface HealthResponse {
  status: 'ok';
  smtpPort: number;
  apiPort: number;
  persistent: boolean;
  emailCount: number;
}
