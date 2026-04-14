import { vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Email, EmailSummary, HealthResponse } from '../types';

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
    listEmails: vi.fn().mockResolvedValue([mockSummary]),
    getEmail: vi.fn().mockResolvedValue(mockEmail),
    deleteEmail: vi.fn().mockResolvedValue(true),
    deleteAllEmails: vi.fn().mockResolvedValue(3),
    health: vi.fn().mockResolvedValue(mockHealth),
    ...overrides,
  };
}
