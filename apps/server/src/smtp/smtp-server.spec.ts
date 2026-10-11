import { createTransport, type TransportOptions } from 'nodemailer';
import pino from 'pino';
import type { Logger } from '../logger.js';
import type { MailStore } from '../db/store.js';
import type { MailService, StorageLimits } from '../mail/mail-service.js';
import { createTestService, silentLogger } from '../testing/mail-fixtures.js';
import type { MailCredentials, TlsMode } from '../types.js';
import { closeSmtp, createSmtpServer, listenSmtp } from './smtp-server.js';
import { generateSelfSignedCert, type TlsCert } from './tls.js';

let certificate: TlsCert;

beforeAll(async () => {
  certificate = await generateSelfSignedCert();
});

interface Harness {
  service: MailService;
  store: MailStore;
  port: number;
  close(): Promise<void>;
}

async function startSmtp(
  options: {
    tls?: TlsMode;
    credentials?: MailCredentials;
    allowInsecureAuth?: boolean;
    limits?: Partial<StorageLimits>;
    logger?: Logger;
  } = {},
): Promise<Harness> {
  const { service, store } = await createTestService(options.limits);
  const tls = options.tls ?? 'none';
  const server = createSmtpServer({
    service,
    logger: options.logger ?? silentLogger,
    tls,
    ...(tls !== 'none' && { certificate }),
    ...(options.credentials && { credentials: options.credentials }),
    allowInsecureAuth: options.allowInsecureAuth ?? false,
    maxClients: 20,
    maxMessageBytes: service.limits.maxMessageBytes,
    closeTimeoutMs: 1000,
  });
  const { port } = await listenSmtp(server, 0, '127.0.0.1');
  return {
    service,
    store,
    port,
    async close() {
      await closeSmtp(server);
      await store.close();
    },
  };
}

function transport(port: number, options: Record<string, unknown> = {}) {
  return createTransport({
    host: '127.0.0.1',
    port,
    secure: false,
    tls: { rejectUnauthorized: false },
    ...options,
  } as TransportOptions);
}

/** A logger that keeps its JSON lines for assertions. */
function capturingLogger(): {
  logger: Logger;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines };
}

const message = {
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'SMTP Test',
  text: 'Test body',
};

describe('SMTP server', () => {
  let smtp: Harness | undefined;

  afterEach(async () => {
    await smtp?.close();
    smtp = undefined;
  });

  it('stores the message with its envelope, including Bcc recipients', async () => {
    smtp = await startSmtp();
    await transport(smtp.port).sendMail({
      ...message,
      bcc: 'hidden@example.com',
    });

    // The server answers 250 only after the email was stored.
    const email = smtp.service.get(1);
    expect(email).toMatchObject({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'SMTP Test',
      envelope: {
        from: 'sender@example.com',
        to: ['recipient@example.com', 'hidden@example.com'],
      },
    });
    expect(email?.raw).not.toContain('hidden@example.com');
  });

  it('keeps CRLF line endings and undoes dot stuffing', async () => {
    smtp = await startSmtp();
    const raw =
      'From: a@example.com\r\nTo: b@example.com\r\nSubject: dots\r\n\r\n.leading dot\r\n..two dots\r\n';
    await transport(smtp.port).sendMail({
      envelope: { from: 'a@example.com', to: ['b@example.com'] },
      raw,
    });
    expect(Buffer.from(smtp.service.getRaw(1) ?? []).toString('utf8')).toBe(
      raw,
    );
  });

  it('refuses an oversized message with 552 and keeps nothing', async () => {
    smtp = await startSmtp({ limits: { maxMessageBytes: 2048 } });
    await expect(
      transport(smtp.port).sendMail({ ...message, text: 'x'.repeat(10_000) }),
    ).rejects.toMatchObject({ responseCode: 552 });
    expect(smtp.service.stats().count).toBe(0);
  });

  it('accepts a message of exactly the size limit and refuses one byte more', async () => {
    const exact =
      'From: a@example.com\r\nTo: b@example.com\r\nSubject: size\r\n\r\n' +
      `${'x'.repeat(76)}\r\n`.repeat(20);
    smtp = await startSmtp({
      limits: { maxMessageBytes: Buffer.byteLength(exact) },
    });
    const port = smtp.port;
    const send = (raw: string) =>
      transport(port).sendMail({
        envelope: { from: 'a@example.com', to: ['b@example.com'] },
        raw,
      });
    await send(exact);
    expect(Buffer.from(smtp.service.getRaw(1) ?? []).toString('utf8')).toBe(
      exact,
    );
    await expect(send(`${exact.slice(0, -2)}x\r\n`)).rejects.toMatchObject({
      responseCode: 552,
    });
    expect(smtp.service.stats().count).toBe(1);
  });

  it('refuses mail with 452 when the mailbox is full', async () => {
    smtp = await startSmtp({ limits: { maxMessages: 1 } });
    await transport(smtp.port).sendMail(message);
    await expect(transport(smtp.port).sendMail(message)).rejects.toMatchObject({
      responseCode: 452,
    });
    expect(smtp.service.stats().count).toBe(1);
  });

  describe('authentication', () => {
    const credentials = { user: 'dev', pass: 'secret' };

    it('accepts any credentials in the local profile once TLS is up', async () => {
      smtp = await startSmtp({ tls: 'starttls' });
      await transport(smtp.port, {
        auth: { user: 'anyone', pass: 'anything' },
        requireTLS: true,
      }).sendMail(message);
      expect(smtp.service.stats().count).toBe(1);
    });

    it('requires the configured credentials', async () => {
      smtp = await startSmtp({
        tls: 'starttls',
        credentials: { user: 'dev', password: 'secret' },
      });
      await transport(smtp.port, {
        auth: credentials,
        requireTLS: true,
      }).sendMail(message);
      await expect(
        transport(smtp.port, {
          auth: { user: 'dev', pass: 'wrong' },
          requireTLS: true,
        }).sendMail(message),
      ).rejects.toMatchObject({ responseCode: 535 });
      await expect(
        transport(smtp.port, { requireTLS: true }).sendMail(message),
      ).rejects.toMatchObject({ responseCode: 530 });
      expect(smtp.service.stats().count).toBe(1);
    });

    it.each(['PLAIN', 'LOGIN'] as const)(
      'checks the configured credentials with AUTH %s',
      async (authMethod) => {
        const { logger, lines } = capturingLogger();
        smtp = await startSmtp({
          tls: 'starttls',
          credentials: { user: 'dev', password: 'secret' },
          logger,
        });
        await transport(smtp.port, {
          auth: credentials,
          authMethod,
          requireTLS: true,
        }).sendMail(message);
        await expect(
          transport(smtp.port, {
            auth: { user: 'dev', pass: 'wrong' },
            authMethod,
            requireTLS: true,
          }).sendMail(message),
        ).rejects.toMatchObject({ responseCode: 535 });
        expect(smtp.service.stats().count).toBe(1);
        // The server logs the mechanism the client used, never the secret.
        expect(lines).toContainEqual(
          expect.objectContaining({
            msg: 'Rejected SMTP authentication',
            method: authMethod,
          }),
        );
        expect(JSON.stringify(lines)).not.toContain('wrong');
      },
    );

    it('refuses authentication before STARTTLS', async () => {
      smtp = await startSmtp({
        tls: 'starttls',
        credentials: { user: 'dev', password: 'secret' },
      });
      await expect(
        transport(smtp.port, { auth: credentials, ignoreTLS: true }).sendMail(
          message,
        ),
      ).rejects.toMatchObject({ responseCode: 538 });
      expect(smtp.service.stats().count).toBe(0);
    });

    it('allows plaintext authentication only with the explicit override', async () => {
      smtp = await startSmtp({
        credentials: { user: 'dev', password: 'secret' },
        allowInsecureAuth: true,
      });
      await transport(smtp.port, { auth: credentials }).sendMail(message);
      expect(smtp.service.stats().count).toBe(1);
    });

    it('works with implicit TLS', async () => {
      smtp = await startSmtp({
        tls: 'implicit',
        credentials: { user: 'dev', password: 'secret' },
      });
      await transport(smtp.port, { secure: true, auth: credentials }).sendMail(
        message,
      );
      expect(smtp.service.stats().count).toBe(1);
    });
  });
});
