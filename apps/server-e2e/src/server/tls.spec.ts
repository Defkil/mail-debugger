import { api, sendMail } from '../helpers/mail.js';
import {
  removeTempDirs,
  startServerProcess,
  stopAllServers,
} from '../helpers/server.js';
import { createTrustedCertificate } from '../helpers/tls.js';

const modes = ['none', 'starttls', 'implicit'] as const;

describe('TLS E2E', () => {
  afterAll(async () => {
    await stopAllServers();
    removeTempDirs();
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

  describe.each(['starttls', 'implicit'] as const)(
    'certificates with TLS mode %s',
    (tls) => {
      it('presents a generated certificate that verifying clients reject', async () => {
        const server = await startServerProcess({ args: ['--tls', tls] });
        try {
          await expect(
            sendMail({ port: server.smtpPort, tls, verify: true }),
          ).rejects.toThrow(/certificate/i);
          expect((await api(server.baseUrl, '/api/emails')).body.total).toBe(0);
        } finally {
          await server.stop();
        }
      }, 30_000);

      it('presents configured certificate files that clients can trust', async () => {
        const certificate = await createTrustedCertificate();
        const server = await startServerProcess({
          args: ['--tls', tls, ...certificate.args],
        });
        try {
          await sendMail(
            { port: server.smtpPort, tls, ca: certificate.cert },
            { subject: `trusted ${tls}` },
          );
          await expect(
            sendMail({ port: server.smtpPort, tls, verify: true }),
          ).rejects.toThrow(/certificate/i);
          const { body } = await api(server.baseUrl, '/api/emails');
          expect(
            body.data.map((email: { subject: string }) => email.subject),
          ).toEqual([`trusted ${tls}`]);
        } finally {
          await server.stop();
        }
      }, 30_000);
    },
  );

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
