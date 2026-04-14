import { parseConfig } from './config.js';
import { createDatabase } from './db/connection.js';
import { EmailRepository } from './db/email-repository.js';
import { createLogger } from './logger.js';
import { createSmtpServer } from './smtp/smtp-server.js';
import { generateSelfSignedCert } from './smtp/tls.js';
import { createApp } from './api/app.js';

const config = parseConfig(process.argv.slice(2));
const logger = createLogger();
const db = createDatabase(config);
const repository = new EmailRepository(db);

const TLS_LABELS: Record<string, string> = {
  none: 'Unverschlüsselt',
  starttls: 'STARTTLS (Upgrade auf TLS nach Verbindungsaufbau)',
  implicit: 'Implicit TLS (verschlüsselt ab Verbindungsaufbau)',
};

async function main() {
  const cert =
    config.tls !== 'none' ? await generateSelfSignedCert() : undefined;

  if (cert) {
    logger.info('Selbstsigniertes TLS-Zertifikat generiert');
  }

  const smtpServer = createSmtpServer(repository, logger, config.tls, cert);
  const app = createApp(repository, config, logger);

  smtpServer.listen(config.smtpPort, '0.0.0.0', () => {
    logger.info(
      { port: config.smtpPort, tls: TLS_LABELS[config.tls] },
      'SMTP-Server gestartet'
    );
  });

  app.listen(config.apiPort, () => {
    logger.info({ port: config.apiPort }, 'API server listening');
    logger.info(
      { url: `http://localhost:${config.apiPort}/swagger` },
      'Swagger UI available'
    );
    logger.info(
      { url: `http://localhost:${config.apiPort}` },
      'Web UI available'
    );
    logger.info({ persistent: config.persist }, 'Storage mode');
  });

  function shutdown() {
    logger.info('Shutting down...');
    smtpServer.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
