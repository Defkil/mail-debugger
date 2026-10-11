import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Mock } from 'vitest';
import pino from 'pino';
import { createTransport } from 'nodemailer';
import { createSmtpServer } from './smtp-server.js';
import { generateSelfSignedCert } from './tls.js';
import type { TlsCert } from './tls.js';
import type { EmailRepository } from '../db/email-repository.js';
import type { ParsedEmail } from '@mail-debugger/types';

const silentLogger = pino({ level: 'silent' });

let testCert: TlsCert;

beforeAll(async () => {
  testCert = await generateSelfSignedCert();
});

function createMockRepository() {
  return {
    insert: vi.fn().mockReturnValue(1),
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    deleteById: vi.fn(),
    deleteAll: vi.fn(),
    count: vi.fn().mockReturnValue(0),
  } as unknown as EmailRepository & { insert: Mock };
}

describe('createSmtpServer', () => {
  it('should create an SMTP server instance without TLS', () => {
    const repo = createMockRepository();
    const server = createSmtpServer(repo, silentLogger, 'none');
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
    expect(typeof server.close).toBe('function');
  });

  it('should accept connections and store emails', async () => {
    const repo = createMockRepository();
    const server = createSmtpServer(repo, silentLogger, 'starttls', testCert);
    server.listen(0, '127.0.0.1');
    await once(server.server, 'listening');
    const { port } = server.server.address() as AddressInfo;

    try {
      const transport = createTransport({
        host: '127.0.0.1',
        port,
        secure: false,
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: 'test@example.com',
        to: 'dest@example.com',
        subject: 'SMTP Test',
        text: 'Test body',
      });

      // The server answers 250 only after the email was stored.
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const insertedEmail: ParsedEmail = repo.insert.mock.calls[0][0];
      expect(insertedEmail.from).toBe('test@example.com');
      expect(insertedEmail.to).toContain('dest@example.com');
      expect(insertedEmail.subject).toBe('SMTP Test');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);
});
