import { api, sendMail } from '../helpers/mail.js';
import {
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

describe('Mail Debugger E2E', () => {
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startServerProcess();
  }, 30_000);

  afterAll(async () => {
    await stopAllServers();
  });

  beforeEach(async () => {
    await api(server.baseUrl, '/api/emails', { method: 'DELETE' });
  });

  const send = (mail: Parameters<typeof sendMail>[1] = {}) =>
    sendMail({ port: server.smtpPort }, mail);

  describe('Health check', () => {
    it('reports the bound ports and the version', async () => {
      const { status, body } = await api(server.baseUrl, '/api/health');

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'ok',
        smtpPort: server.smtpPort,
        apiPort: server.apiPort,
        persistent: false,
        version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
    });
  });

  describe('SMTP capture and API retrieval', () => {
    it('lists an email sent via SMTP as soon as the delivery succeeded', async () => {
      await send();

      const { status, body } = await api(server.baseUrl, '/api/emails');

      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        from: 'e2e-sender@example.com',
        to: ['e2e-recipient@example.com'],
        subject: 'E2E Test Email',
        receivedAt: expect.stringMatching(/T.*\.\d{3}Z$/),
      });
    });

    it('returns full email details by ID, including the SMTP envelope', async () => {
      await send({
        html: '<p>This is an e2e test email body.</p>',
        bcc: 'hidden@example.com',
      });
      const listBody = (await api(server.baseUrl, '/api/emails')).body;
      const emailId = listBody.data[0].id;

      const { status, body } = await api(
        server.baseUrl,
        `/api/emails/${emailId}`,
      );

      expect(status).toBe(200);
      expect(body.data).toMatchObject({
        from: 'e2e-sender@example.com',
        subject: 'E2E Test Email',
        textBody: expect.stringContaining('This is an e2e test email body.'),
        htmlBody: expect.stringContaining(
          '<p>This is an e2e test email body.</p>',
        ),
        envelope: {
          from: 'e2e-sender@example.com',
          to: ['e2e-recipient@example.com', 'hidden@example.com'],
        },
      });
      expect(body.data.raw).toContain('Subject: E2E Test Email');
    });
  });

  describe('Filtering and paging', () => {
    it('filters by subject case-insensitively', async () => {
      await send({ subject: 'Welcome' });
      await send({ subject: 'Password Reset' });

      const { body } = await api(server.baseUrl, '/api/emails?subject=welcome');

      expect(body.data).toHaveLength(1);
      expect(body.data[0].subject).toBe('Welcome');
    });

    it('filters by sender', async () => {
      await send({ from: 'alice@example.com' });
      await send({ from: 'bob@example.com' });

      const { body } = await api(server.baseUrl, '/api/emails?from=alice');

      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('alice@example.com');
    });

    it('applies offset without limit and rejects invalid paging', async () => {
      await send({ subject: 'one' });
      await send({ subject: 'two' });

      const { body } = await api(server.baseUrl, '/api/emails?offset=1');
      expect(body).toMatchObject({ total: 2, data: [{ subject: 'one' }] });

      const invalid = await api(server.baseUrl, '/api/emails?limit=500');
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('Deletion', () => {
    it('deletes a single email', async () => {
      await send();
      const emailId = (await api(server.baseUrl, '/api/emails')).body.data[0]
        .id;

      const deleted = await api(server.baseUrl, `/api/emails/${emailId}`, {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(200);

      const missing = await api(server.baseUrl, `/api/emails/${emailId}`);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({
        error: { code: 'EMAIL_NOT_FOUND', message: 'Email not found' },
      });
    });

    it('deletes all emails and never reuses their ids', async () => {
      await send({ subject: 'Email 1' });
      await send({ subject: 'Email 2' });
      const before = (await api(server.baseUrl, '/api/emails')).body.data[0].id;

      const deleteBody = (
        await api(server.baseUrl, '/api/emails', { method: 'DELETE' })
      ).body;
      expect(deleteBody.deleted).toBe(2);
      expect((await api(server.baseUrl, '/api/emails')).body.data).toHaveLength(
        0,
      );

      await send({ subject: 'Email 3' });
      const after = (await api(server.baseUrl, '/api/emails')).body.data[0].id;
      expect(after).toBe(before + 1);
    });

    it('returns 404 when deleting a non-existent email', async () => {
      const { status } = await api(server.baseUrl, '/api/emails/99999', {
        method: 'DELETE',
      });
      expect(status).toBe(404);
    });
  });
});
