import { createTransport } from 'nodemailer';

const SMTP_PORT = (globalThis as Record<string, unknown>)
  .__SMTP_PORT__ as number;
const API_PORT = (globalThis as Record<string, unknown>)
  .__API_PORT__ as number;
const API_BASE = `http://localhost:${API_PORT}`;

function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

function createMailTransport() {
  return createTransport({
    host: '127.0.0.1',
    port: SMTP_PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
}

async function sendTestEmail(overrides: Record<string, string> = {}) {
  const transport = createMailTransport();
  await transport.sendMail({
    from: overrides.from ?? 'e2e-sender@example.com',
    to: overrides.to ?? 'e2e-recipient@example.com',
    subject: overrides.subject ?? 'E2E Test Email',
    text: overrides.text ?? 'This is an e2e test email body.',
    html: overrides.html ?? '<p>This is an e2e test email body.</p>',
  });
}

describe('Mail Debugger E2E', () => {
  beforeEach(async () => {
    // Clean up all emails before each test
    await api('/api/emails', { method: 'DELETE' });
  });

  describe('Health check', () => {
    it('should return health status', async () => {
      const res = await api('/api/health');
      const body = await jsonBody(res);

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.smtpPort).toBe(SMTP_PORT);
      expect(body.apiPort).toBe(API_PORT);
      expect(body.persistent).toBe(false);
    });
  });

  describe('SMTP capture and API retrieval', () => {
    it('should catch an email sent via SMTP and list it via API', async () => {
      await sendTestEmail();

      // Small delay for async processing
      await new Promise((r) => setTimeout(r, 300));

      const res = await api('/api/emails');
      const body = await jsonBody(res);

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('e2e-sender@example.com');
      expect(body.data[0].to).toContain('e2e-recipient@example.com');
      expect(body.data[0].subject).toBe('E2E Test Email');
    });

    it('should return full email details by ID', async () => {
      await sendTestEmail();
      await new Promise((r) => setTimeout(r, 300));

      const listRes = await api('/api/emails');
      const listBody = await jsonBody(listRes);
      const emailId = listBody.data[0].id;

      const detailRes = await api(`/api/emails/${emailId}`);
      const detailBody = await jsonBody(detailRes);

      expect(detailRes.status).toBe(200);
      expect(detailBody.data.from).toBe('e2e-sender@example.com');
      expect(detailBody.data.subject).toBe('E2E Test Email');
      expect(detailBody.data.textBody).toContain(
        'This is an e2e test email body.'
      );
      expect(detailBody.data.htmlBody).toContain(
        '<p>This is an e2e test email body.</p>'
      );
      expect(detailBody.data.raw).toBeDefined();
    });
  });

  describe('Filtering', () => {
    it('should filter emails by subject', async () => {
      await sendTestEmail({ subject: 'Welcome' });
      await sendTestEmail({ subject: 'Password Reset' });
      await new Promise((r) => setTimeout(r, 300));

      const res = await api('/api/emails?subject=Welcome');
      const body = await jsonBody(res);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].subject).toBe('Welcome');
    });

    it('should filter emails by from address', async () => {
      await sendTestEmail({ from: 'alice@example.com' });
      await sendTestEmail({ from: 'bob@example.com' });
      await new Promise((r) => setTimeout(r, 300));

      const res = await api('/api/emails?from=alice');
      const body = await jsonBody(res);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('alice@example.com');
    });
  });

  describe('Deletion', () => {
    it('should delete a single email', async () => {
      await sendTestEmail();
      await new Promise((r) => setTimeout(r, 300));

      const listRes = await api('/api/emails');
      const listBody = await jsonBody(listRes);
      const emailId = listBody.data[0].id;

      const deleteRes = await api(`/api/emails/${emailId}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);

      const getRes = await api(`/api/emails/${emailId}`);
      expect(getRes.status).toBe(404);
    });

    it('should delete all emails', async () => {
      await sendTestEmail({ subject: 'Email 1' });
      await sendTestEmail({ subject: 'Email 2' });
      await new Promise((r) => setTimeout(r, 300));

      const deleteRes = await api('/api/emails', { method: 'DELETE' });
      const deleteBody = await jsonBody(deleteRes);
      expect(deleteBody.deleted).toBe(2);

      const listRes = await api('/api/emails');
      const listBody = await jsonBody(listRes);
      expect(listBody.data).toHaveLength(0);
    });

    it('should return 404 when deleting non-existent email', async () => {
      const res = await api('/api/emails/99999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });
});
