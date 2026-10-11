import type { AddressInfo } from 'node:net';
import {
  SMTPServer,
  type SMTPServerAddress,
  type SMTPServerDataStream,
  type SMTPServerSession,
} from 'smtp-server';
import type { SmtpEnvelope } from '@mail-debugger/types';
import { safeEqual } from '../crypto.js';
import type { Logger } from '../logger.js';
import { ServiceError } from '../mail/errors.js';
import { listen } from '../net-listen.js';
import type { MailService } from '../mail/mail-service.js';
import type { MailCredentials, TlsMode } from '../types.js';
import type { TlsCert } from './tls.js';

export interface SmtpServerOptions {
  service: MailService;
  logger: Logger;
  tls: TlsMode;
  certificate?: TlsCert;
  /** When set, clients must authenticate with exactly these credentials. */
  credentials?: MailCredentials;
  /** Allows AUTH before TLS; only valid on loopback. */
  allowInsecureAuth: boolean;
  maxClients: number;
  maxMessageBytes: number;
  /** How long close() waits for clients before disconnecting them. */
  closeTimeoutMs: number;
}

type SmtpError = Error & { responseCode: number };

function smtpError(responseCode: number, message: string): SmtpError {
  return Object.assign(new Error(message), { responseCode });
}

/** Maps a failed delivery to an SMTP reply the client can act on. */
export function toSmtpError(error: unknown): SmtpError {
  if (error instanceof ServiceError) {
    switch (error.code) {
      case 'STORAGE_FULL': {
        return smtpError(452, `4.3.1 ${error.message}`);
      }
      case 'MESSAGE_TOO_LARGE': {
        return smtpError(552, `5.3.4 ${error.message}`);
      }
      case 'SHUTTING_DOWN': {
        return smtpError(421, '4.3.2 The server is shutting down');
      }
    }
  }
  return smtpError(451, '4.3.0 The message could not be stored');
}

function toEnvelope(session: SMTPServerSession): SmtpEnvelope {
  const mailFrom = session.envelope.mailFrom as SMTPServerAddress | false;
  return {
    from: mailFrom ? mailFrom.address || null : null,
    to: session.envelope.rcptTo.map((recipient) => recipient.address),
  };
}

/**
 * The catch-all SMTP listener. Without configured credentials any client may
 * send, with or without (any) authentication; with credentials, clients
 * must authenticate, and only after TLS unless insecure authentication is
 * allowed.
 */
export function createSmtpServer(options: SmtpServerOptions): SMTPServer {
  const { service, credentials } = options;
  const log = options.logger.child({ component: 'smtp' });

  const server = new SMTPServer({
    secure: options.tls === 'implicit',
    disabledCommands: options.tls === 'none' ? ['STARTTLS'] : [],
    ...(options.certificate && {
      key: options.certificate.key,
      cert: options.certificate.cert,
    }),
    size: options.maxMessageBytes,
    maxClients: options.maxClients,
    closeTimeout: options.closeTimeoutMs,
    authMethods: ['PLAIN', 'LOGIN'],
    authOptional: !credentials,
    allowInsecureAuth: options.allowInsecureAuth,
    banner: 'mail-debugger',
    logger: false,
    onAuth(auth, _session, callback) {
      if (!credentials) {
        // Local development profile: any credentials are accepted.
        callback(null, { user: auth.username || 'anonymous' });
        return;
      }
      if (
        safeEqual(auth.username ?? '', credentials.user) &&
        safeEqual(auth.password ?? '', credentials.password)
      ) {
        callback(null, { user: credentials.user });
        return;
      }
      log.warn({ method: auth.method }, 'Rejected SMTP authentication');
      callback(smtpError(535, '5.7.8 Invalid username or password'));
    },
    onMailFrom(_address, _session, callback) {
      try {
        service.assertCapacity();
        callback();
      } catch (error) {
        callback(toSmtpError(error));
      }
    },
    onData(stream, session, callback) {
      receive(stream, session, callback);
    },
  });
  // smtp-server re-emits errors of its listening socket; a bind failure is
  // reported by listenSmtp, later ones are logged here.
  server.on('error', (error: Error) => {
    if (server.server.listening) log.error({ err: error }, 'SMTP server error');
  });
  return server;

  function receive(
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
    callback: (error?: Error | null) => void,
  ): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (error: Error | null = null) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      callback(error);
    };

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Past the limit the rest is drained without being kept in memory.
      if (!stream.sizeExceeded && size <= options.maxMessageBytes) {
        chunks.push(chunk);
      }
    });
    stream.on('error', (error: Error) => {
      log.warn({ err: error }, 'SMTP data stream failed');
      settle(error);
    });
    stream.on('end', () => {
      if (settled) return;
      if (stream.sizeExceeded || size > options.maxMessageBytes) {
        log.warn(
          { size, limit: options.maxMessageBytes },
          'Rejected an oversized message',
        );
        settle(
          smtpError(
            552,
            `5.3.4 The message exceeds the maximum size of ${options.maxMessageBytes} bytes`,
          ),
        );
        return;
      }
      void deliver(Buffer.concat(chunks, size), toEnvelope(session), settle);
    });
  }

  async function deliver(
    raw: Buffer,
    envelope: SmtpEnvelope,
    settle: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      const received = await service.receive(raw, envelope);
      log.info(
        { id: received.id, bytes: raw.length, recipients: envelope.to.length },
        'Email received',
      );
      log.debug(
        {
          id: received.id,
          from: received.summary.from,
          to: received.summary.to,
          subject: received.summary.subject,
        },
        'Email details',
      );
      settle();
    } catch (error) {
      if (error instanceof ServiceError) {
        log.warn({ code: error.code }, error.message);
      } else {
        log.error({ err: error }, 'Failed to store an email');
      }
      settle(toSmtpError(error));
    }
  }
}

/** Starts listening and resolves with the bound address (port 0 picks one). */
export function listenSmtp(
  server: SMTPServer,
  port: number,
  host: string,
): Promise<AddressInfo> {
  return listen(server.server, port, host);
}

/** Stops accepting connections and waits for clients up to the close timeout. */
export function closeSmtp(server: SMTPServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
