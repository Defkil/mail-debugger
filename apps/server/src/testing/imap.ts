import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import type { MailStore } from '../db/store.js';
import {
  DEFAULT_IMAP_CREDENTIALS,
  imapLimits,
  startImapServer,
  type ImapLimits,
  type ImapListener,
} from '../imap/imap-server.js';
import type { Logger } from '../logger.js';
import type { MailService } from '../mail/mail-service.js';
import { generateSelfSignedCert } from '../smtp/tls.js';
import type { TlsMode } from '../types.js';
import { ImapTranscript } from './imap-transcript.js';
import { createTestService, silentLogger } from './mail-fixtures.js';

/** A FLAGS item without stored flags (\Recent belongs to the session). */
export const NO_FLAGS = /FLAGS \((\\Recent)?\)/;

export interface TestImap {
  service: MailService;
  store: MailStore;
  listener: ImapListener;
  port: number;
}

const running: TestImap[] = [];
const clients: ImapFlow[] = [];
const transcripts: ImapTranscript[] = [];

/** Starts an IMAP server on a free port over an in-memory mailbox. */
export async function startTestImap(
  options: {
    tls?: TlsMode;
    plaintextAuth?: boolean;
    limits?: Partial<ImapLimits>;
    service?: { service: MailService; store: MailStore };
    logger?: Logger;
  } = {},
): Promise<TestImap> {
  const { service, store } = options.service ?? (await createTestService());
  const tls = options.tls ?? 'none';
  const listener = await startImapServer({
    service,
    logger: options.logger ?? silentLogger,
    host: '127.0.0.1',
    port: 0,
    tls,
    ...(tls !== 'none' && { certificate: await generateSelfSignedCert() }),
    credentials: DEFAULT_IMAP_CREDENTIALS,
    plaintextAuth: options.plaintextAuth ?? tls === 'none',
    limits: {
      ...imapLimits(service.limits.maxMessageBytes),
      ...options.limits,
    },
  });
  const imap = { service, store, listener, port: listener.address.port };
  running.push(imap);
  return imap;
}

/** An ImapFlow client with the development login; connect it yourself. */
export function imapClient(
  port: number,
  options: Partial<ImapFlowOptions> = {},
): ImapFlow {
  const client = new ImapFlow({
    host: '127.0.0.1',
    port,
    secure: false,
    doSTARTTLS: false,
    auth: {
      user: DEFAULT_IMAP_CREDENTIALS.user,
      pass: DEFAULT_IMAP_CREDENTIALS.password,
    },
    logger: false,
    disableAutoIdle: true,
    ...options,
  });
  clients.push(client);
  return client;
}

/** A raw connection that has read the greeting. */
export async function rawImap(
  port: number,
  options: { tls?: boolean } = {},
): Promise<ImapTranscript> {
  const raw = await ImapTranscript.connect(port, options);
  transcripts.push(raw);
  await raw.greeting();
  return raw;
}

/** A raw connection logged in with the development login. */
export async function loggedInImap(port: number): Promise<ImapTranscript> {
  const raw = await rawImap(port);
  await raw.command('L', 'LOGIN mail-debugger mail-debugger');
  return raw;
}

/** Closes every client and server the helpers created. */
export async function closeTestImaps(): Promise<void> {
  for (const raw of transcripts.splice(0)) raw.close();
  for (const client of clients.splice(0)) client.close();
  for (const imap of running.splice(0)) {
    await imap.listener.close(1000);
    await imap.store.close();
  }
}
