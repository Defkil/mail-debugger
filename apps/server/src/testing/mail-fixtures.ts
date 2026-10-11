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

/** A multipart/mixed message with a text part and one base64 attachment. */
export function attachmentMessage(attachment: {
  /** Encoded as an RFC 2231 UTF-8 parameter. */
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Buffer {
  const name = `UTF-8''${encodeURIComponent(attachment.filename)}`;
  const lines = [
    'From: sender@example.com',
    'To: recipient@example.com',
    'Subject: Attachment',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="fixture-boundary"',
    '',
    '--fixture-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See the attachment.',
    '--fixture-boundary',
    `Content-Type: ${attachment.contentType}`,
    `Content-Disposition: attachment; filename*=${name}`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(attachment.bytes).toString('base64'),
    '--fixture-boundary--',
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
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
