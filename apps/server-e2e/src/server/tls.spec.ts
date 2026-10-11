import { api, sendMail } from '../helpers/mail.js';
import { startServerProcess, stopAllServers } from '../helpers/server.js';

const modes = ['none', 'starttls', 'implicit'] as const;

describe('TLS E2E', () => {
  afterAll(async () => {
    await stopAllServers();
  });

  describe.each(modes)('TLS mode: %s', (tls) => {
    it('accepts mail in this mode and stores it', async () => {
      const server = await startServerProcess({ args: ['--tls', tls] });
      try {
        await sendMail(
          { port: server.smtpPort, tls },
          { from: `tls-${tls}@example.com`, subject: `TLS ${tls} test` },
        );

        const { body } = await api(server.baseUrl, '/api/emails');
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({
          from: `tls-${tls}@example.com`,
          subject: `TLS ${tls} test`,
        });
      } finally {
        await server.stop();
      }
    }, 30_000);
  });

  it('requires the configured credentials after STARTTLS', async () => {
    const server = await startServerProcess({
      args: ['--tls', 'starttls', '--auth-user', 'dev'],
      env: { MAIL_DEBUGGER_AUTH_PASSWORD: 'e2e-secret' },
    });
    try {
      await expect(
        sendMail({ port: server.smtpPort, tls: 'starttls' }),
      ).rejects.toMatchObject({ responseCode: 530 });
      await expect(
        sendMail({
          port: server.smtpPort,
          tls: 'starttls',
          auth: { user: 'dev', pass: 'wrong' },
        }),
      ).rejects.toMatchObject({ responseCode: 535 });
      await sendMail({
        port: server.smtpPort,
        tls: 'starttls',
        auth: { user: 'dev', pass: 'e2e-secret' },
      });
      expect((await api(server.baseUrl, '/api/emails')).body.total).toBe(1);
      expect(server.output()).not.toContain('e2e-secret');
    } finally {
      await server.stop();
    }
  }, 30_000);
});
