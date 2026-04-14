import type { Mock } from 'vitest';
import { emailRoutes } from './emails';
import type { EmailRepository } from '../../db/email-repository';
import type { EmailSummary, Email } from '../../types';

const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test',
  receivedAt: '2025-01-01 00:00:00',
  hasAttachments: false,
};

const mockEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test',
  textBody: 'Hello',
  htmlBody: null,
  raw: 'raw email content',
  headers: { from: 'sender@example.com' },
  attachments: [],
  receivedAt: '2025-01-01 00:00:00',
};

function createMockRepo() {
  return {
    findAll: vi.fn().mockReturnValue({ data: [mockSummary], total: 1 }),
    findById: vi.fn().mockReturnValue(mockEmail),
    deleteById: vi.fn().mockReturnValue(true),
    deleteAll: vi.fn().mockReturnValue(1),
    insert: vi.fn(),
    count: vi.fn().mockReturnValue(1),
  } as unknown as EmailRepository & {
    findAll: Mock;
    findById: Mock;
    deleteById: Mock;
    deleteAll: Mock;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

describe('email routes', () => {
  describe('GET /api/emails', () => {
    it('should return list of emails', async () => {
      const repo = createMockRepo();
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails')
      );
      const body = await jsonBody(res);

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('sender@example.com');
    });

    it('should pass filter query params to repository', async () => {
      const repo = createMockRepo();
      const app = emailRoutes(repo);

      await app.handle(
        new Request(
          'http://localhost/api/emails?from=test&subject=hello'
        )
      );

      expect(repo.findAll).toHaveBeenCalledWith(
        { from: 'test', subject: 'hello' },
        undefined,
        undefined
      );
    });
  });

  describe('GET /api/emails/:id', () => {
    it('should return email details', async () => {
      const repo = createMockRepo();
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails/1')
      );
      const body = await jsonBody(res);

      expect(res.status).toBe(200);
      expect(body.data.from).toBe('sender@example.com');
      expect(body.data.textBody).toBe('Hello');
    });

    it('should return 404 for non-existent email', async () => {
      const repo = createMockRepo();
      repo.findById.mockReturnValue();
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails/999')
      );

      expect(res.status).toBe(404);
      const body = await jsonBody(res);
      expect(body.error).toBe('Email not found');
    });
  });

  describe('DELETE /api/emails/:id', () => {
    it('should delete email and return 200', async () => {
      const repo = createMockRepo();
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails/1', {
          method: 'DELETE',
        })
      );

      expect(res.status).toBe(200);
      const body = await jsonBody(res);
      expect(body.deleted).toBe(true);
    });

    it('should return 404 when email not found', async () => {
      const repo = createMockRepo();
      repo.deleteById.mockReturnValue(false);
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails/999', {
          method: 'DELETE',
        })
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/emails', () => {
    it('should delete all emails and return count', async () => {
      const repo = createMockRepo();
      repo.deleteAll.mockReturnValue(3);
      const app = emailRoutes(repo);

      const res = await app.handle(
        new Request('http://localhost/api/emails', {
          method: 'DELETE',
        })
      );
      const body = await jsonBody(res);

      expect(res.status).toBe(200);
      expect(body.deleted).toBe(3);
    });
  });
});
