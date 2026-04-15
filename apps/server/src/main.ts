import { parseConfig } from './config.js';
import { createDatabase, persistDatabase } from './db/connection.js';
import { EmailRepository } from './db/email-repository.js';
import { createLogger } from './logger.js';
import { createSmtpServer } from './smtp/smtp-server.js';
import { generateSelfSignedCert } from './smtp/tls.js';
import { createApp } from './api/app.js';

const TLS_LABELS: Record<string, string> = {
  none: 'Unencrypted',
  starttls: 'STARTTLS (upgrade to TLS after connection)',
  implicit: 'Implicit TLS (encrypted from connection start)',
};

async function main() {
  const config = parseConfig(process.argv.slice(2));
  const logger = createLogger();
  const db = await createDatabase(config);
  const repository = new EmailRepository(db);

  const cert =
    config.tls === 'none' ? undefined : await generateSelfSignedCert();

  if (cert) {
    logger.info('Self-signed TLS certificate generated');
  }

  const smtpServer = createSmtpServer(repository, logger, config.tls, cert);
  const app = createApp(repository, config, logger, { serveWeb: true });

  smtpServer.listen(config.smtpPort, '0.0.0.0', () => {
    logger.info(
      { port: config.smtpPort, tls: TLS_LABELS[config.tls] },
      'SMTP server listening',
    );
  });

  app.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort }, 'API server listening');
    logger.info(
      { url: `http://localhost:${config.apiPort}/swagger` },
      'Swagger UI available',
    );
    logger.info(
      { url: `http://localhost:${config.apiPort}` },
      'Web UI available',
    );
    logger.info({ persistent: config.persist }, 'Storage mode');
  });

  function shutdown() {
    logger.info('Shutting down...');
    smtpServer.close(() => {
      if (config.persist) persistDatabase(db);
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
