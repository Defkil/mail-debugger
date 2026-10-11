import net, { type AddressInfo } from 'node:net';
import tls from 'node:tls';
import imapkit, { type IMAPConnection, type IMAPServer } from 'imapkit';
import type { Logger } from '../logger.js';
import type { MailService } from '../mail/mail-service.js';
import { listen } from '../net-listen.js';
import type { TlsCert } from '../smtp/tls.js';
import type { MailCredentials, TlsMode } from '../types.js';
import { getVersion } from '../version.js';
import { MailboxAdapter } from './mailbox-adapter.js';
import { mailboxProfile } from './mailbox-plugin.js';
import {
  limitOutput,
  limitSessionTime,
  outputLimits,
  type OutputLimits,
  type SessionTimeouts,
} from './output-control.js';

/** The development login when no credentials are configured. */
export const DEFAULT_IMAP_CREDENTIALS: Readonly<MailCredentials> = {
  user: 'mail-debugger',
  password: 'mail-debugger',
};

export interface ImapLimits extends SessionTimeouts {
  /** Most sessions at once; more are answered with BYE. */
  maxSessions: number;
  /** Largest literal after login; IMAP cannot upload messages. */
  maxLiteralBytes: number;
  output: OutputLimits;
}

export const DEFAULT_MAX_IMAP_SESSIONS = 20;

/** The limits for a largest accepted message size. */
export function imapLimits(maxMessageBytes: number): ImapLimits {
  return {
    maxSessions: DEFAULT_MAX_IMAP_SESSIONS,
    preAuthMs: 30_000,
    idleMs: 30 * 60_000,
    maxLiteralBytes: 64 * 1024,
    output: outputLimits(maxMessageBytes),
  };
}

export interface ImapServerOptions {
  service: MailService;
  logger: Logger;
  host: string;
  /** 0 picks a free port. */
  port: number;
  tls: TlsMode;
  /** Required unless `tls` is none. */
  certificate?: TlsCert;
  /** The account clients log in with. */
  credentials: MailCredentials;
  /** Whether authentication is allowed on a connection without TLS. */
  plaintextAuth: boolean;
  limits: ImapLimits;
}

export interface ImapListener {
  readonly address: AddressInfo;
  /**
   * Stops accepting connections, says BYE to every session, gives them
   * `graceMs` to finish and then closes the rest. Idempotent.
   */
  close(graceMs: number): Promise<void>;
}

/**
 * Starts the IMAP listener: ImapKit speaks the protocol, the
 * {@link MailboxAdapter} connects it to the mailbox, and this module owns
 * the sockets, TLS, session limits and shutdown. ImapKit's own SMTP and
 * REST listeners, default users, certificates and scripting stay unused.
 */
export async function startImapServer(
  options: ImapServerOptions,
): Promise<ImapListener> {
  if (options.tls !== 'none' && !options.certificate) {
    throw new Error('IMAP with TLS needs a certificate');
  }
  const { limits } = options;
  const log = options.logger.child({ component: 'imap' });
  const credentials = options.certificate && {
    key: options.certificate.key,
    cert: options.certificate.cert,
  };

  let adapter: MailboxAdapter | undefined;
  const imap: IMAPServer = imapkit({
    plugins: [
      'ID',
      'IDLE',
      'NAMESPACE',
      'UNSELECT',
      'UIDPLUS',
      'LITERAL-',
      ...(options.tls === 'starttls' ? ['STARTTLS'] : []),
      mailboxProfile({
        service: options.service,
        logger: log,
        credentials: options.credentials,
        plaintextAuth: options.plaintextAuth,
        output: limits.output,
        onAdapter: (created) => (adapter = created),
      }),
    ],
    // No accounts of ImapKit's own: the profile checks the credentials.
    users: {},
    storage: MailboxAdapter.storage(options.service),
    secureConnection: options.tls === 'implicit',
    ...(credentials && { credentials }),
    maxLiteralSize: limits.maxLiteralBytes,
    id: { name: 'mail-debugger', version: getVersion() },
  });
  if (!adapter) throw new Error('The IMAP mailbox profile did not load');
  const mailbox = adapter;
  mailbox.attach();

  const stopTimers = new Map<number, () => void>();
  imap.connectionHandlers.push((connection: IMAPConnection) => {
    const session = connection.sessionNumber;
    limitOutput(connection, limits.output, (reason, pendingBytes) =>
      log.warn(
        { session, reason, pendingBytes },
        'Disconnected an IMAP client that does not read its responses',
      ),
    );
    stopTimers.set(
      session,
      limitSessionTime(connection, limits, () => {
        log.info({ session }, 'Logged out an inactive IMAP session');
        connection.bye('Autologout; idle for too long');
      }),
    );
    log.debug({ session }, 'IMAP session opened');
  });
  imap.on(
    'session',
    (event: { type: string; session: { session: number } }) => {
      if (event.type !== 'close') return;
      stopTimers.get(event.session.session)?.();
      stopTimers.delete(event.session.session);
      log.debug({ session: event.session.session }, 'IMAP session closed');
    },
  );

  const accept = (socket: net.Socket) => {
    socket.on('error', (error) =>
      log.debug({ err: error }, 'IMAP socket error'),
    );
    if (imap.connections.size >= limits.maxSessions) {
      log.warn(
        { limit: limits.maxSessions },
        'Refused an IMAP connection: too many sessions',
      );
      socket.end('* BYE [UNAVAILABLE] Too many connections\r\n');
      socket.setTimeout(5000, () => socket.destroy());
      return;
    }
    imap.createClient(socket);
  };

  let listener: net.Server;
  if (options.tls === 'implicit') {
    const tlsServer = tls.createServer(
      {
        ...credentials,
        handshakeTimeout: limits.preAuthMs,
        minVersion: 'TLSv1.2',
      },
      accept,
    );
    // Bounds connections that are still in the TLS handshake.
    tlsServer.maxConnections = limits.maxSessions * 2;
    tlsServer.on('tlsClientError', (error) =>
      log.debug({ err: error }, 'IMAP TLS handshake failed'),
    );
    listener = tlsServer;
  } else {
    listener = net.createServer(accept);
  }

  let address: AddressInfo;
  try {
    address = await listen(listener, options.port, options.host);
  } catch (error) {
    mailbox.detach();
    throw error;
  }
  listener.on('error', (error) =>
    log.error({ err: error }, 'IMAP server error'),
  );

  let closing: Promise<void> | undefined;
  return {
    address,
    close(graceMs) {
      closing ??= (async () => {
        mailbox.detach();
        const closed = new Promise<void>((resolve) =>
          listener.close(() => resolve()),
        );
        for (const connection of imap.connections) {
          if (connection.isOpen()) connection.bye('Server shutting down');
        }
        await sessionsGone(imap, graceMs);
        for (const connection of imap.connections) connection.socket?.destroy();
        await closed;
      })();
      return closing;
    },
  };
}

/** Resolves when every session closed, or after `timeoutMs`. */
function sessionsGone(imap: IMAPServer, timeoutMs: number): Promise<void> {
  if (imap.connections.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      imap.off('session', onSession);
      resolve();
    };
    const onSession = () => {
      if (imap.connections.size === 0) done();
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref();
    imap.on('session', onSession);
  });
}
