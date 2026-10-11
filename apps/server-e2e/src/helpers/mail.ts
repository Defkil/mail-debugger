import { createTransport } from 'nodemailer';

export interface SendOptions {
  port: number;
  /** none: plain; starttls: upgrade required; implicit: TLS from the start. */
  tls?: 'none' | 'starttls' | 'implicit';
  auth?: { user: string; pass: string };
}

export interface TestMail {
  from?: string;
  to?: string | string[];
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Exact message source; replaces the other content fields. */
  raw?: Buffer;
}

/**
 * Sends a message with Nodemailer. The server answers 250 only after the
 * message is stored, so it is visible over the API once this resolves.
 */
export async function sendMail(options: SendOptions, mail: TestMail = {}) {
  const tls = options.tls ?? 'none';
  const transport = createTransport({
    host: '127.0.0.1',
    port: options.port,
    secure: tls === 'implicit',
    requireTLS: tls === 'starttls',
    ignoreTLS: tls === 'none',
    // The server presents a generated self-signed certificate.
    tls: { rejectUnauthorized: false },
    ...(options.auth && { auth: options.auth }),
  });
  try {
    if (mail.raw) {
      return await transport.sendMail({
        envelope: {
          from: mail.from ?? 'e2e-sender@example.com',
          to: mail.to ?? 'e2e-recipient@example.com',
        },
        raw: mail.raw,
      });
    }
    return await transport.sendMail({
      from: mail.from ?? 'e2e-sender@example.com',
      to: mail.to ?? 'e2e-recipient@example.com',
      subject: mail.subject ?? 'E2E Test Email',
      text: mail.text ?? 'This is an e2e test email body.',
      ...(mail.cc && { cc: mail.cc }),
      ...(mail.bcc && { bcc: mail.bcc }),
      ...(mail.html && { html: mail.html }),
      ...(mail.attachments && { attachments: mail.attachments }),
    });
  } finally {
    transport.close();
  }
}

/** JSON request against the server's HTTP API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests assert on the parsed JSON
export async function api<T = any>(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; body: T }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep the text
  }
  return {
    status: response.status,
    headers: response.headers,
    body: body as T,
  };
}
