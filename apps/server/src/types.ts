import type { StorageLimits } from './mail/mail-service.js';

export interface EmailAddress {
  name: string;
  address: string;
}

export type TlsMode = 'none' | 'starttls' | 'implicit';

/** Credentials that SMTP clients must present when configured. */
export interface MailCredentials {
  user: string;
  password: string;
}

/** Validated configuration of a server run. */
export interface ServerConfig {
  /** Interface of every listener; loopback unless explicitly exposed. */
  host: string;
  /** SMTP port; 0 picks a free port. */
  smtpPort: number;
  /** HTTP port of the web UI, REST API and docs; 0 picks a free port. */
  apiPort: number;
  tls: TlsMode;
  /** PEM files of the certificate; a self-signed one is generated when absent. */
  tlsCertFile?: string;
  tlsKeyFile?: string;
  /** When set, SMTP clients must authenticate with exactly these credentials. */
  credentials?: MailCredentials;
  /** Allows SMTP AUTH without TLS (loopback only). */
  allowInsecureAuth: boolean;
  /** Directory of the persistent mailbox; in memory when absent. */
  dataDir?: string;
  limits: StorageLimits;
  /** Most simultaneous SMTP connections. */
  maxSmtpClients: number;
  /** Bearer token that the REST API requires when set. */
  apiToken?: string;
  /** Additional Host header values the HTTP server accepts. */
  httpAllowedHosts: string[];
  /** Additional browser origins the HTTP server accepts. */
  httpAllowedOrigins: string[];
  /** The IMAP listener; absent unless enabled with --imap. */
  imap?: ImapConfig;
  /** The MCP endpoint at /mcp; absent unless enabled with --mcp. */
  mcp?: McpConfig;
}

export interface McpConfig {
  /** Offer the delete_email and clear_emails tools. */
  allowMutations: boolean;
  /** Bearer token that /mcp requires when set. */
  token?: string;
}

export interface ImapConfig {
  /** IMAP port; 0 picks a free port. */
  port: number;
}
