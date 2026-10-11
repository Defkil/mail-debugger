import { vi } from 'vitest';
import type {
  ApiClient,
  Email,
  EmailSummary,
  HealthResponse,
} from '@mail-debugger/client';

export const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  receivedAt: '2025-01-01T00:00:00Z',
  hasAttachments: false,
};

export const mockEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test Subject',
  textBody: 'Hello World',
  htmlBody: null,
  raw: 'raw',
  headers: {},
  attachments: [],
  receivedAt: '2025-01-01T00:00:00Z',
};

export const mockHealth: HealthResponse = {
  status: 'ok',
  smtpPort: 1025,
  apiPort: 3000,
  persistent: false,
  emailCount: 5,
};

export function createMockClient(overrides?: Partial<ApiClient>): ApiClient {
  return {
    baseUrl: 'http://127.0.0.1:3000',
    listEmails: vi.fn().mockResolvedValue({ data: [mockSummary], total: 1 }),
    getEmail: vi.fn().mockResolvedValue(mockEmail),
    getRawEmail: vi.fn().mockResolvedValue(new TextEncoder().encode('raw')),
    getAttachment: vi.fn(),
    waitForEmail: vi.fn().mockResolvedValue({
      data: mockSummary,
      timedOut: false,
      highWatermark: 1,
      mailboxId: 'test-mailbox',
    }),
    deleteEmail: vi.fn().mockResolvedValue(true),
    deleteAllEmails: vi.fn().mockResolvedValue(3),
    health: vi.fn().mockResolvedValue(mockHealth),
    ...overrides,
  };
}
