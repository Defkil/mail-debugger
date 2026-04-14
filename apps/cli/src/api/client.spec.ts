import { createApiClient } from './client';
import type { Email, EmailSummary, HealthResponse } from '../types';

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

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('createApiClient', () => {
  const API_URL = 'http://localhost:3000';

  function mockFetch(body: unknown, status = 200) {
    return jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  describe('listEmails', () => {
    it('should fetch emails without filter', async () => {
      const spy = mockFetch({ data: [mockSummary] });
      const client = createApiClient(API_URL);

      const result = await client.listEmails();

      expect(spy).toHaveBeenCalledWith(`${API_URL}/api/emails`, undefined);
      expect(result).toEqual([mockSummary]);
    });

    it('should pass filter params as query string', async () => {
      const spy = mockFetch({ data: [mockSummary] });
      const client = createApiClient(API_URL);

      await client.listEmails({ from: 'alice@test.com', subject: 'hello' });

      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('from=alice%40test.com');
      expect(url).toContain('subject=hello');
    });

    it('should return empty array when no emails', async () => {
      mockFetch({ data: [] });
      const client = createApiClient(API_URL);

      const result = await client.listEmails();

      expect(result).toEqual([]);
    });
  });

  describe('getEmail', () => {
    it('should fetch email by id', async () => {
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

      await expect(client.listEmails()).rejects.toThrow(
        'Something went wrong'
      );
    });

    it('should fall back to HTTP status when body has no error field', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('not json', { status: 502 }));
      const client = createApiClient(API_URL);

      await expect(client.listEmails()).rejects.toThrow('HTTP 502');
    });
  });
});
