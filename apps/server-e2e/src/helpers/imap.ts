import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import type { ServerProcess } from './server.js';

/** The development login of the IMAP listener. */
export const DEV_LOGIN = { user: 'mail-debugger', pass: 'mail-debugger' };

const clients = new Set<ImapFlow>();
const transcripts = new Set<ImapTranscript>();

/** The IMAP port of a server started with --imap. */
export function imapPort(server: ServerProcess): number {
  if (server.imapPort === undefined) {
    throw new Error('The server runs without --imap');
  }
  return server.imapPort;
}

/** An ImapFlow client for a loopback port; call connect() yourself. */
export function imapClient(
  port: number,
  options: Partial<ImapFlowOptions> = {},
): ImapFlow {
  const client = new ImapFlow({
    host: '127.0.0.1',
    port,
    secure: false,
    doSTARTTLS: false,
    auth: DEV_LOGIN,
    logger: false,
    disableAutoIdle: true,
    ...options,
  });
  clients.add(client);
  client.on('error', () => {
    // Failures surface through the awaited calls.
  });
  return client;
}

/** Closes every client and transcript the helpers created. */
export function closeImapClients(): void {
  for (const client of clients) client.close();
  clients.clear();
  for (const transcript of transcripts) transcript.close();
  transcripts.clear();
}

/** All chunks of a download stream as one buffer. */
export async function readAll(
  stream: AsyncIterable<unknown> | undefined,
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The attachment bytes of {@link multipartFixture}. */
export const ATTACHMENT_BYTES = Buffer.from([0, 1, 2, 255]);

/**
 * A multipart/mixed message with an encoded UTF-8 subject and display name,
 * a quoted-printable UTF-8 text part and a base64 attachment of
 * {@link ATTACHMENT_BYTES}. Lines end with CRLF.
 */
export function multipartFixture(
  options: { subject?: string; messageId?: string } = {},
): Buffer {
  const subject = options.subject ?? 'Grüße aus dem Test';
  const lines = [
    'From: =?UTF-8?Q?J=C3=BCrgen_Sender?= <sender@example.test>',
    'To: Recipient <recipient@example.test>, other@example.test',
    'Cc: copy@example.test',
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    `Message-ID: ${options.messageId ?? '<multipart-fixture@example.test>'}`,
    'Date: Sun, 11 Oct 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="fixture-boundary"',
    '',
    '--fixture-boundary',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Gr=C3=BC=C3=9Fe =E2=80=94 the body.',
    '--fixture-boundary',
    'Content-Type: application/octet-stream; name="bytes.bin"',
    'Content-Disposition: attachment; filename="bytes.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    ATTACHMENT_BYTES.toString('base64'),
    '--fixture-boundary--',
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * A raw IMAP connection for protocol transcripts. Output is decoded as
 * latin1, so literal lengths count octets.
 */
export class ImapTranscript {
  private output = '';
  private readonly listeners = new Set<() => void>();
  private ended = false;

  private constructor(public socket: net.Socket) {
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      this.output += chunk;
      this.notify();
    });
    socket.on('close', () => {
      this.ended = true;
      this.notify();
    });
    socket.on('error', () => {
      // Reported through `closed`.
    });
    transcripts.add(this);
  }

  /** Connects and reads the greeting. */
  static async open(
    port: number,
    options: { tls?: boolean; ca?: string } = {},
  ): Promise<{ transcript: ImapTranscript; greeting: string }> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const connection = options.tls
        ? tls.connect({
            host: '127.0.0.1',
            port,
            servername: 'localhost',
            ...(options.ca
              ? { ca: options.ca }
              : { rejectUnauthorized: false }),
          })
        : net.connect({ host: '127.0.0.1', port });
      connection.once(options.tls ? 'secureConnect' : 'connect', () =>
        resolve(connection),
      );
      connection.once('error', reject);
    });
    const transcript = new ImapTranscript(socket);
    const greeting = await transcript.readUntil((text) =>
      text.includes('\r\n'),
    );
    return { transcript, greeting };
  }

  /** Connects, reads the greeting and logs in with the development login. */
  static async loggedIn(port: number): Promise<ImapTranscript> {
    const { transcript } = await this.open(port);
    await transcript.command('L', 'LOGIN mail-debugger mail-debugger');
    return transcript;
  }

  get closed(): boolean {
    return this.ended;
  }

  write(data: string): void {
    this.socket.write(data, 'latin1');
  }

  /** Sends a tagged command and returns the output up to its tagged response. */
  command(tag: string, line: string, timeoutMs?: number): Promise<string> {
    this.write(`${tag} ${line}\r\n`);
    return this.tagged(tag, timeoutMs);
  }

  /** Reads up to and including the tagged response with `tag`. */
  tagged(tag: string, timeoutMs?: number): Promise<string> {
    const pattern = new RegExp(
      String.raw`(^|\r\n)${tag} (OK|NO|BAD)[^\r]*\r\n`,
    );
    return this.readUntil((text) => pattern.test(text), timeoutMs);
  }

  /** Consumes output until `done` returns true for it. */
  readUntil(
    done: (text: string) => boolean,
    timeoutMs = 5000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (done(this.output)) {
          cleanup();
          const text = this.output;
          this.output = '';
          resolve(text);
        } else if (this.ended) {
          cleanup();
          reject(new Error(`Connection closed; received:\n${this.output}`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out; received:\n${this.output}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }

  /** Upgrades the connection after a STARTTLS command answered OK. */
  async startTls(): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    const secure = tls.connect({
      socket: plain,
      servername: 'localhost',
      rejectUnauthorized: false,
    });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    secure.setEncoding('latin1');
    secure.on('data', (chunk: string) => {
      this.output += chunk;
      this.notify();
    });
    this.socket = secure;
  }

  close(): void {
    this.socket.destroy();
    transcripts.delete(this);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
