import { SMTPServer } from 'smtp-server';
import type { EmailRepository } from '../db/email-repository.js';
import type { Logger } from '../logger.js';
import type { TlsMode } from '../types.js';
import { parseEmail } from '../parser/email-parser.js';
import type { TlsCert } from './tls.js';

export function createSmtpServer(
  repository: EmailRepository,
  logger: Logger,
  tls: TlsMode,
  cert?: TlsCert,
): SMTPServer {
  const log = logger.child({ component: 'smtp' });

  const useTls = tls !== 'none';
  const tlsOptions = useTls && cert ? { key: cert.key, cert: cert.cert } : {};

  return new SMTPServer({
    authOptional: true,
    secure: tls === 'implicit',
    disabledCommands: useTls ? [] : ['STARTTLS'],
    ...tlsOptions,
    logger: false,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', async () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        try {
          const parsed = await parseEmail(raw);
          const id = repository.insert(parsed);
          log.info(
            { id, from: parsed.from, to: parsed.to, subject: parsed.subject },
            'Email received',
          );
          callback();
        } catch (error) {
          log.error({ err: error }, 'Failed to process email');
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    onAuth(_auth, _session, callback) {
      callback(null, { user: 'anonymous' });
    },
  });
}
