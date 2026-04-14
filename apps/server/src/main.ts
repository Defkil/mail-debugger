import { parseConfig } from './config.js';
import { createDatabase } from './db/connection.js';
import { EmailRepository } from './db/email-repository.js';
import { createLogger } from './logger.js';
import { createSmtpServer } from './smtp/smtp-server.js';
import { createApp } from './api/app.js';

const config = parseConfig(process.argv.slice(2));
const logger = createLogger();
const db = createDatabase(config);
const repository = new EmailRepository(db);

const smtpServer = createSmtpServer(repository, logger);
const app = createApp(repository, config, logger);

smtpServer.listen(config.smtpPort, '0.0.0.0', () => {
  logger.info({ port: config.smtpPort }, 'SMTP server listening');
});

app.listen(config.apiPort, () => {
  logger.info({ port: config.apiPort }, 'API server listening');
  logger.info(
    { url: `http://localhost:${config.apiPort}/swagger` },
    'Swagger UI available'
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
