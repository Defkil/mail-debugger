import { parseConfig } from './config.js';
import { createDatabase, persistDatabase } from './db/connection.js';
import { EmailRepository } from './db/email-repository.js';
import { createLogger } from './logger.js';
import { createSmtpServer } from './smtp/smtp-server.js';
import { generateSelfSignedCert } from './smtp/tls.js';
import { createApp } from './api/app.js';

const TLS_LABELS: Record<string, string> = {
  none: 'Unverschlüsselt',
  starttls: 'STARTTLS (Upgrade auf TLS nach Verbindungsaufbau)',
  implicit: 'Implicit TLS (verschlüsselt ab Verbindungsaufbau)',
};

/**
 * `--cli` switches to the bundled CLI. Strip it out of argv before the CLI's
 * own parser sees it so the rest of argv is interpreted as CLI arguments.
 */
async function dispatchCliIfRequested(): Promise<boolean> {
  const cliIndex = process.argv.indexOf('--cli');
  if (cliIndex === -1) return false;

  const cliArgv = [
    ...process.argv.slice(2, cliIndex),
    ...process.argv.slice(cliIndex + 1),
  ];
  // Bundled via esbuild so this resolves without the CLI package being
  // installed as a separate runtime dependency. The enforce-module-boundaries
  // rule is disabled here because the single-bin publish model means the
  // server ships the CLI, not the other way around.
  // eslint-disable-next-line @nx/enforce-module-boundaries
  const { runCli } = await import('@mail-debugger/cli/run-cli');
  // eslint-disable-next-line @nx/enforce-module-boundaries
  const { getErrorMessage } = await import('@mail-debugger/cli/error');
  try {
    await runCli(cliArgv);
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exit(1);
  }
  return true;
}

async function main() {
  if (await dispatchCliIfRequested()) return;

  const config = parseConfig(process.argv.slice(2));
  const logger = createLogger();
  const db = await createDatabase(config);
  const repository = new EmailRepository(db);

  const cert =
    config.tls === 'none' ? undefined : await generateSelfSignedCert();

  if (cert) {
    logger.info('Selbstsigniertes TLS-Zertifikat generiert');
  }

  const smtpServer = createSmtpServer(repository, logger, config.tls, cert);
  const app = createApp(repository, config, logger, { serveWeb: true });

  smtpServer.listen(config.smtpPort, '0.0.0.0', () => {
    logger.info(
      { port: config.smtpPort, tls: TLS_LABELS[config.tls] },
      'SMTP-Server gestartet',
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
