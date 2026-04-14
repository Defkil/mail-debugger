import type { Email, EmailSummary, HealthResponse } from '@mail-debugger/types';
import { createApiClient } from './api-client.js';

const API_URL = 'http://localhost:3000';

const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  receivedAt: '2025-01-01T00:00:00Z',
  hasAttachments: false,
};

const mockEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test Subject',
  textBody: 'Hello World',
  htmlBody: null,
  raw: 'raw email content',
  headers: { from: 'sender@example.com' },
  attachments: [],
  receivedAt: '2025-01-01T00:00:00Z',
};

const mockHealth: HealthResponse = {
  status: 'ok',
  smtpPort: 1025,
  apiPort: 3000,
  persistent: false,
  emailCount: 5,
};

function mockFetch(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json(body, { status }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createApiClient', () => {
  describe('listEmails', () => {
    it('should fetch emails without filter and return PaginatedResponse', async () => {
      const payload = { data: [mockSummary], total: 1 };
      const spy = mockFetch(payload);
      const client = createApiClient(API_URL);

      const result = await client.listEmails();

      expect(spy).toHaveBeenCalledWith(`${API_URL}/api/emails`, undefined);
      expect(result).toEqual(payload);
    });

    it('should pass filter and pagination params as query string', async () => {
      const spy = mockFetch({ data: [], total: 0 });
      const client = createApiClient(API_URL);

      await client.listEmails(
        { from: 'alice@test.com', subject: 'hello' },
        10,
        20,
      );

      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('from=alice%40test.com');
      expect(url).toContain('subject=hello');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('should return empty paginated response when no emails', async () => {
      mockFetch({ data: [], total: 0 });
      const client = createApiClient(API_URL);

      const result = await client.listEmails();

      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe('getEmail', () => {
    it('should fetch email by id and unwrap data field', async () => {
      const spy = mockFetch({ data: mockEmail });
      const client = createApiClient(API_URL);

      const result = await client.getEmail(1);

      expect(spy).toHaveBeenCalledWith(`${API_URL}/api/emails/1`, undefined);
      expect(result).toEqual(mockEmail);
    });

    it('should throw on 404', async () => {
      mockFetch({ error: 'Email not found' }, 404);
      const client = createApiClient(API_URL);

      await expect(client.getEmail(999)).rejects.toThrow('Email not found');
    });
  });

  describe('deleteEmail', () => {
    it('should delete email by id', async () => {
      const spy = mockFetch({ deleted: true });
      const client = createApiClient(API_URL);

      const result = await client.deleteEmail(1);

      expect(spy).toHaveBeenCalledWith(`${API_URL}/api/emails/1`, {
        method: 'DELETE',
      });
      expect(result).toBe(true);
    });

    it('should return false for non-existent email', async () => {
      mockFetch({ deleted: false });
      const client = createApiClient(API_URL);

      const result = await client.deleteEmail(999);

      expect(result).toBe(false);
    });
  });

  describe('deleteAllEmails', () => {
    it('should delete all emails and return count', async () => {
      const spy = mockFetch({ deleted: 3 });
      const client = createApiClient(API_URL);

      const result = await client.deleteAllEmails();

      expect(spy).toHaveBeenCalledWith(`${API_URL}/api/emails`, {
        method: 'DELETE',
      });
      expect(result).toBe(3);
    });
  });

  describe('health', () => {
    it('should return health data', async () => {
      mockFetch(mockHealth);
      const client = createApiClient(API_URL);

      const result = await client.health();

      expect(result).toEqual(mockHealth);
    });
  });

  describe('error handling', () => {
    it('should throw with error field from response body', async () => {
      mockFetch({ error: 'Something went wrong' }, 500);
      const client = createApiClient(API_URL);

      await expect(client.listEmails()).rejects.toThrow('Something went wrong');
    });

    it('should fall back to HTTP status when body has no error field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not json', { status: 502 }),
      );
      const client = createApiClient(API_URL);

      await expect(client.listEmails()).rejects.toThrow('HTTP 502');
    });

    it('should use empty base URL for relative requests', async () => {
      const spy = mockFetch({ data: [], total: 0 });
      const client = createApiClient('');

      await client.listEmails();

      expect(spy).toHaveBeenCalledWith('/api/emails', undefined);
    });
  });
});
