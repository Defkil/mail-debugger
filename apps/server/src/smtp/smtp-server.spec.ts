import type { Mock } from 'vitest';
import pino from 'pino';
import { createSmtpServer } from './smtp-server';
import { generateSelfSignedCert } from './tls';
import type { TlsCert } from './tls';
import type { EmailRepository } from '../db/email-repository';
import type { ParsedEmail } from '../types';

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

  it('should accept connections and store emails', () => {
    return new Promise<void>((resolve, reject) => {
      const repo = createMockRepository();
      const server = createSmtpServer(repo, silentLogger, 'starttls', testCert);

      const port = 2599;

      server.listen(port, '127.0.0.1', () => {
        import('nodemailer').then(({ createTransport }) => {
          const transport = createTransport({
            host: '127.0.0.1',
            port,
            secure: false,
            tls: { rejectUnauthorized: false },
          });

          transport.sendMail(
            {
              from: 'test@example.com',
              to: 'dest@example.com',
              subject: 'SMTP Test',
              text: 'Test body',
            },
            (err) => {
              try {
                expect(err).toBeNull();
              } catch (error) {
                server.close(() => reject(error));
                return;
              }

              setTimeout(() => {
                try {
                  expect(repo.insert).toHaveBeenCalledTimes(1);
                  const insertedEmail: ParsedEmail =
                    repo.insert.mock.calls[0][0];
                  expect(insertedEmail.from).toBe('test@example.com');
                  expect(insertedEmail.to).toContain('dest@example.com');
                  expect(insertedEmail.subject).toBe('SMTP Test');
                  server.close(() => resolve());
                } catch (error) {
                  server.close(() => reject(error));
                }
              }, 200);
            }
          );
        });
      });
    });
  }, 10_000);
});
