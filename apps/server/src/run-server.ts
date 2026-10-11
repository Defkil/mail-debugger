import type { AddressInfo } from 'node:net';
import {
  formatServerHelp,
  parseServerArgs,
  UsageError,
  type ServerCommand,
} from './config.js';
import { createLogger, type Logger } from './logger.js';
import { startServer, StartupError, type RunningServer } from './runtime.js';
import type { ServerConfig } from './types.js';
import { getVersion } from './version.js';

/** Upper bound for a graceful shutdown before the process exits anyway. */
export const SHUTDOWN_DEADLINE_MS = 15_000;

export interface ServerProgram {
  /** Command name used in messages, e.g. "mail-debugger". */
  name: string;
  /** Directory of the built web inbox; omit for the API-only server. */
  webDir?: string;
  /** Lists the serve and cli commands in the help. */
  withCommands?: boolean;
}

/**
 * Runs the server command line: parses the options, prints help or the
 * version without opening sockets, or starts the server and stops it on
 * SIGINT/SIGTERM (a second signal exits immediately). Sets the exit code:
 * 2 for usage errors, 1 when the server cannot start.
 */
export async function runServerProgram(
  argv: readonly string[],
  program: ServerProgram,
): Promise<void> {
  let command: ServerCommand;
  try {
    command = parseServerArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(
      `${program.name}: ${error.message}\nRun "${program.name} --help" for the options.\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (command.kind === 'help') {
    process.stdout.write(
      formatServerHelp(program.name, {
        withCommands: program.withCommands ?? false,
        withWeb: program.webDir !== undefined,
      }),
    );
    return;
  }
  if (command.kind === 'version') {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  const logger = createLogger();
  let server: RunningServer;
  try {
    server = await startServer(command.config, {
      logger,
      ...(program.webDir && { webDir: program.webDir }),
    });
  } catch (error) {
    if (error instanceof StartupError) {
      logger.error(error.message);
    } else {
      logger.error({ err: error }, 'mail-debugger could not start');
    }
    process.exitCode = 1;
    return;
  }
  logStartup(logger, server, command.config, program);
  stopOnSignals(server, logger);
}

function httpUrl(address: AddressInfo, path = ''): string {
  const host =
    address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}${path}`;
}

function logStartup(
  logger: Logger,
  server: RunningServer,
  config: ServerConfig,
  program: ServerProgram,
): void {
  logger.info(
    {
      tls: config.tls,
      auth: config.credentials ? 'required' : 'optional',
    },
    `SMTP server listening on ${server.smtp.address}:${server.smtp.port}`,
  );
  if (server.imap) {
    logger.info(
      {
        tls: config.tls,
        login: config.credentials ? 'configured' : 'mail-debugger',
      },
      `IMAP server listening on ${server.imap.address}:${server.imap.port}`,
    );
  }
  if (program.webDir) {
    logger.info(`Web inbox: ${httpUrl(server.http)}`);
  }
  logger.info(
    `REST API: ${httpUrl(server.http, '/api')} (docs: ${httpUrl(server.http, '/swagger')})`,
  );
  if (config.mcp) {
    logger.info(
      {
        tools: config.mcp.allowMutations ? 'read and delete' : 'read-only',
        token: config.mcp.token ? 'required' : 'none',
      },
      `MCP: ${httpUrl(server.http, '/mcp')}`,
    );
  }
  logger.info(
    config.dataDir
      ? `Mail is kept in ${config.dataDir}`
      : 'Mail is kept in memory only (use --persist or --data-dir to keep it)',
  );
  // A stable, machine-readable line for scripts that wait for the server.
  logger.info(
    {
      version: getVersion(),
      host: config.host,
      smtpPort: server.smtp.port,
      apiPort: server.http.port,
      ...(server.imap && { imapPort: server.imap.port }),
    },
    'mail-debugger is ready',
  );
}

async function closeAndExit(
  server: RunningServer,
  logger: Logger,
): Promise<void> {
  try {
    await server.close();
  } catch (error) {
    logger.error({ err: error }, 'Shutdown failed');
    process.exit(1);
  }
  logger.info('Stopped');
  process.exit(0);
}

function stopOnSignals(server: RunningServer, logger: Logger): void {
  let stopping = false;
  const stop = (reason: string) => {
    if (stopping) {
      logger.warn('Second stop request: exiting immediately');
      process.exit(1);
    }
    stopping = true;
    logger.info({ reason }, 'Shutting down');
    const deadline = setTimeout(() => {
      logger.error('Shutdown took too long; exiting');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    void closeAndExit(server, logger);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // Windows has no catchable termination signal for child processes; a
  // parent that spawned the server with an IPC channel can send "shutdown".
  if (process.send) {
    process.on('message', (message) => {
      if (message === 'shutdown') stop('shutdown message');
    });
  }
}
