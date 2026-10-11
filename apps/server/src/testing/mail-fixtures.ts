import pino from 'pino';
import { openStore, type MailStore } from '../db/store.js';
import {
  DEFAULT_LIMITS,
  MailService,
  type StorageLimits,
} from '../mail/mail-service.js';

/** A logger that discards everything. */
export const silentLogger = pino({ level: 'silent' });

/** An in-memory mailbox for tests. */
export async function createTestService(
  limits: Partial<StorageLimits> = {},
): Promise<{ service: MailService; store: MailStore }> {
  const store = await openStore({ logger: silentLogger });
  const service = new MailService(
    store,
    { ...DEFAULT_LIMITS, ...limits },
    silentLogger,
  );
  return { service, store };
}

export interface MessageOptions {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  headers?: Record<string, string>;
}

/** A small RFC 5322 message with CRLF line endings. */
export function rawMessage(options: MessageOptions = {}): Buffer {
  const lines = [
    `From: ${options.from ?? 'sender@example.com'}`,
    `To: ${options.to ?? 'recipient@example.com'}`,
    ...(options.cc ? [`Cc: ${options.cc}`] : []),
    `Subject: ${options.subject ?? 'Test subject'}`,
    'Message-ID: <fixture@example.com>',
    ...Object.entries(options.headers ?? {}).map(
      ([name, value]) => `${name}: ${value}`,
    ),
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.text ?? 'Hello, world!',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}
