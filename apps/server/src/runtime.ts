import type { AddressInfo } from 'node:net';
import { createApp } from './api/app.js';
import { createHttpPolicy, type HttpPolicy } from './api/guards.js';
import { listenHttp, type HttpListener } from './api/listener.js';
import { openStore } from './db/store.js';
import type { ImapListener } from './imap/imap-server.js';
import type { Logger } from './logger.js';
import type { McpEndpoint } from './mcp/http.js';
import { MailService } from './mail/mail-service.js';
import { describeListenError } from './net-listen.js';
import { closeSmtp, createSmtpServer, listenSmtp } from './smtp/smtp-server.js';
import { loadCertificate } from './smtp/tls.js';
import type { ServerConfig } from './types.js';

/** Time that SMTP and HTTP clients get to finish during shutdown. */
export const SHUTDOWN_GRACE_MS = 5000;

/** A startup failure with a message meant for the user. */
export class StartupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StartupError';
  }
}

export interface StartServerOptions {
  logger: Logger;
  /** Directory of the built web inbox; omit for the API-only server. */
  webDir?: string;
}

export interface RunningServer {
  /** Bound SMTP address (the actual port when 0 was requested). */
  readonly smtp: AddressInfo;
  /** Bound HTTP address (the actual port when 0 was requested). */
  readonly http: AddressInfo;
  /** Bound IMAP address, when IMAP is enabled. */
  readonly imap?: AddressInfo;
  /** Whether /mcp serves MCP. */
  readonly mcp: boolean;
  readonly service: MailService;
  /**
   * Stops accepting mail and connections, lets clients finish within the
   * grace period, writes the final snapshot and closes the database. Calling
   * it again returns the same promise.
   */
  close(): Promise<void>;
}

/**
 * Starts the mailbox with its SMTP and HTTP listeners. Initialization
 * happens here rather than at import time. If any step fails, everything
 * already opened is closed again before the error propagates.
 */
export async function startServer(
  config: ServerConfig,
  options: StartServerOptions,
): Promise<RunningServer> {
  const { logger } = options;
  const store = await startupStep(
    () => openStore({ dataDir: config.dataDir, logger }),
    (error) =>
      `Cannot open the mailbox${config.dataDir ? ` in ${config.dataDir}` : ''}: ${(error as Error).message}`,
  );
  const service = new MailService(store, config.limits, logger);
  let smtpServer: ReturnType<typeof createSmtpServer> | undefined;
  let smtpOpen = false;
  let http: HttpListener | undefined;
  let imap: ImapListener | undefined;
  let mcp: McpEndpoint | undefined;

  try {
    const certificate = await loadCertificate(config);
    smtpServer = createSmtpServer({
      service,
      logger,
      tls: config.tls,
      ...(certificate && { certificate }),
      ...(config.credentials && { credentials: config.credentials }),
      allowInsecureAuth: config.allowInsecureAuth,
      maxClients: config.maxSmtpClients,
      maxMessageBytes: config.limits.maxMessageBytes,
      closeTimeoutMs: SHUTDOWN_GRACE_MS,
    });
    const smtp = smtpServer;
    const smtpAddress = await startupStep(
      () => listenSmtp(smtp, config.smtpPort, config.host),
      (error) =>
        describeListenError(
          error,
          'SMTP',
          '--smtp-port',
          config.host,
          config.smtpPort,
        ),
    );
    smtpOpen = true;

    if (config.mcp) {
      // Loaded on demand: a server without --mcp never loads the MCP SDK.
      const { createMcpEndpoint } = await import('./mcp/http.js');
      mcp = createMcpEndpoint({
        service,
        logger,
        allowMutations: config.mcp.allowMutations,
      });
    }
    const mcpToken = config.mcp?.token;

    let policy: HttpPolicy | undefined;
    const app = createApp({
      service,
      logger,
      ...(options.webDir && { webDir: options.webDir }),
      ...(mcp && { mcp }),
      info: () => ({
        smtpPort: smtpAddress.port,
        apiPort: http?.address.port ?? config.apiPort,
        ...(imap && { imapPort: imap.address.port }),
        ...(mcp && { mcp: true }),
      }),
      policy: () => {
        policy ??= createHttpPolicy({
          host: config.host,
          port: http?.address.port ?? config.apiPort,
          allowedHosts: config.httpAllowedHosts,
          allowedOrigins: config.httpAllowedOrigins,
          ...(config.apiToken && { apiToken: config.apiToken }),
          ...(mcpToken && { mcpToken }),
        });
        return policy;
      },
    });
    http = await startupStep(
      () =>
        listenHttp((request) => app.fetch(request), {
          host: config.host,
          port: config.apiPort,
          logger,
        }),
      (error) =>
        describeListenError(
          error,
          'HTTP',
          '--api-port',
          config.host,
          config.apiPort,
        ),
    );

    if (config.imap) {
      const imapConfig = config.imap;
      // Loaded on demand: a server without --imap never loads ImapKit.
      const { imapLimits, startImapServer, DEFAULT_IMAP_CREDENTIALS } =
        await import('./imap/imap-server.js');
      imap = await startupStep(
        () =>
          startImapServer({
            service,
            logger,
            host: config.host,
            port: imapConfig.port,
            tls: config.tls,
            ...(certificate && { certificate }),
            credentials: config.credentials ?? DEFAULT_IMAP_CREDENTIALS,
            plaintextAuth: allowsPlaintextImapAuth(config),
            limits: imapLimits(config.limits.maxMessageBytes),
          }),
        (error) =>
          describeListenError(
            error,
            'IMAP',
            '--imap-port',
            config.host,
            imapConfig.port,
          ),
      );
    }

    const httpListener = http;
    const imapListener = imap;
    const mcpEndpoint = mcp;
    let closing: Promise<void> | undefined;
    return {
      smtp: smtpAddress,
      http: httpListener.address,
      ...(imapListener && { imap: imapListener.address }),
      mcp: !!mcpEndpoint,
      service,
      close() {
        closing ??= (async () => {
          // Ends pending waits, including those of MCP clients.
          service.stopAccepting();
          await Promise.allSettled([
            mcpEndpoint?.close(),
            httpListener.close(SHUTDOWN_GRACE_MS),
            closeSmtp(smtp),
            imapListener?.close(SHUTDOWN_GRACE_MS),
          ]);
          await store.close();
        })();
        return closing;
      },
    };
  } catch (error) {
    service.stopAccepting();
    await Promise.allSettled([
      mcp?.close(),
      imap?.close(0),
      http?.close(0),
      smtpServer && smtpOpen ? closeSmtp(smtpServer) : undefined,
    ]);
    try {
      await store.close();
    } catch (closeError) {
      logger.error({ err: closeError }, 'Could not close the mailbox');
    }
    throw error;
  }
}

/**
 * Whether IMAP clients may log in without TLS: the development login on a
 * plain loopback listener, configured credentials only with
 * --allow-insecure-auth. With STARTTLS the login waits for TLS unless
 * insecure authentication is allowed.
 */
export function allowsPlaintextImapAuth(
  config: Pick<ServerConfig, 'tls' | 'credentials' | 'allowInsecureAuth'>,
): boolean {
  return config.allowInsecureAuth
    ? true
    : config.tls === 'none' && !config.credentials;
}

/** Runs a startup step and turns its failure into a {@link StartupError}. */
async function startupStep<T>(
  step: () => Promise<T>,
  describe: (error: unknown) => string,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new StartupError(describe(error), { cause: error });
  }
}
