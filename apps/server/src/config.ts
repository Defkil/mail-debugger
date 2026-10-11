import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_LIMITS } from './mail/mail-service.js';
import type { MailCredentials, ServerConfig, TlsMode } from './types.js';

/** A command line or environment problem; the process exits with code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_SMTP_PORT = 2525;
export const DEFAULT_API_PORT = 3000;
export const DEFAULT_MAX_SMTP_CLIENTS = 20;

const TLS_MODES: readonly TlsMode[] = ['none', 'starttls', 'implicit'];

/** Environment variables the server reads. */
export const ENVIRONMENT = {
  apiToken: 'MAIL_DEBUGGER_API_TOKEN',
  authPassword: 'MAIL_DEBUGGER_AUTH_PASSWORD',
} as const;

interface OptionSpec {
  name: string;
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  /** Placeholder of the value in the help text. */
  value?: string;
  default?: string;
  description: string;
}

/** Options of the server; the help text is generated from this table. */
export const SERVER_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'host',
    type: 'string',
    value: 'address',
    default: DEFAULT_HOST,
    description:
      'Interface for all listeners. Anything but loopback requires --tls, mail credentials and MAIL_DEBUGGER_API_TOKEN',
  },
  {
    name: 'smtp-port',
    type: 'string',
    value: 'port',
    default: String(DEFAULT_SMTP_PORT),
    description: 'SMTP port (0 picks a free port)',
  },
  {
    name: 'api-port',
    type: 'string',
    value: 'port',
    default: String(DEFAULT_API_PORT),
    description:
      'HTTP port of the web inbox, REST API and API docs (0 picks a free port)',
  },
  {
    name: 'tls',
    type: 'string',
    value: 'none|starttls|implicit',
    default: 'none',
    description: 'SMTP encryption',
  },
  {
    name: 'tls-cert',
    type: 'string',
    value: 'file',
    description:
      'PEM certificate, together with --tls-key (default: a generated self-signed certificate)',
  },
  {
    name: 'tls-key',
    type: 'string',
    value: 'file',
    description: 'PEM private key of --tls-cert',
  },
  {
    name: 'auth-user',
    type: 'string',
    value: 'name',
    description:
      'Require SMTP authentication as this user; the password comes from MAIL_DEBUGGER_AUTH_PASSWORD or --auth-password-file',
  },
  {
    name: 'auth-password-file',
    type: 'string',
    value: 'file',
    description: 'File that contains the password of --auth-user',
  },
  {
    name: 'allow-insecure-auth',
    type: 'boolean',
    description:
      'Allow SMTP authentication without TLS (only on a loopback --host)',
  },
  {
    name: 'persist',
    type: 'boolean',
    description: 'Keep mail across restarts in the current directory',
  },
  {
    name: 'data-dir',
    type: 'string',
    value: 'dir',
    description: 'Keep mail across restarts in this directory',
  },
  {
    name: 'max-message-bytes',
    type: 'string',
    value: 'bytes',
    default: String(DEFAULT_LIMITS.maxMessageBytes),
    description: 'Largest accepted message',
  },
  {
    name: 'max-messages',
    type: 'string',
    value: 'count',
    default: String(DEFAULT_LIMITS.maxMessages),
    description: 'Most messages kept; new mail is refused when reached',
  },
  {
    name: 'max-storage-bytes',
    type: 'string',
    value: 'bytes',
    default: String(DEFAULT_LIMITS.maxStorageBytes),
    description: 'Most bytes kept; new mail is refused when reached',
  },
  {
    name: 'http-allowed-host',
    type: 'string',
    multiple: true,
    value: 'host[:port]',
    description:
      'Also accept this Host header, e.g. behind a reverse proxy (repeatable)',
  },
  {
    name: 'http-allowed-origin',
    type: 'string',
    multiple: true,
    value: 'origin',
    description: 'Also accept requests from this browser origin (repeatable)',
  },
  { name: 'help', short: 'h', type: 'boolean', description: 'Show this help' },
  { name: 'version', type: 'boolean', description: 'Show the version' },
];

export type ServerCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; config: ServerConfig };

export interface ParseContext {
  env: Record<string, string | undefined>;
  cwd: string;
  readFile: (file: string) => string;
}

const defaultContext = (): ParseContext => ({
  env: process.env,
  cwd: process.cwd(),
  readFile: (file) => readFileSync(file, 'utf8'),
});

/**
 * Parses the server command line strictly: unknown or repeated options,
 * missing values, malformed numbers and contradictory settings are errors.
 * Throws {@link UsageError}.
 */
export function parseServerArgs(
  argv: readonly string[],
  context: ParseContext = defaultContext(),
): ServerCommand {
  const { values, tokens } = parseStrict(argv);
  assertNoRepeats(tokens);

  if (values['help']) return { kind: 'help' };
  if (values['version']) return { kind: 'version' };

  const host = parseHost(stringValue(values, 'host') ?? DEFAULT_HOST);
  const tls = parseTlsMode(stringValue(values, 'tls') ?? 'none');
  const tlsCertFile = stringValue(values, 'tls-cert');
  const tlsKeyFile = stringValue(values, 'tls-key');
  if ((tlsCertFile === undefined) !== (tlsKeyFile === undefined)) {
    throw new UsageError('--tls-cert and --tls-key must be given together');
  }
  if (tlsCertFile && tls === 'none') {
    throw new UsageError(
      '--tls-cert and --tls-key need --tls starttls or --tls implicit',
    );
  }

  const credentials = parseCredentials(values, context);
  const allowInsecureAuth = values['allow-insecure-auth'] === true;

  const limits = {
    maxMessageBytes: parseCount(
      values,
      'max-message-bytes',
      DEFAULT_LIMITS.maxMessageBytes,
    ),
    maxMessages: parseCount(values, 'max-messages', DEFAULT_LIMITS.maxMessages),
    maxStorageBytes: parseCount(
      values,
      'max-storage-bytes',
      DEFAULT_LIMITS.maxStorageBytes,
    ),
  };
  if (limits.maxMessageBytes > limits.maxStorageBytes) {
    throw new UsageError(
      '--max-message-bytes must not be larger than --max-storage-bytes',
    );
  }

  const dataDirValue = stringValue(values, 'data-dir');
  if (dataDirValue === '') throw new UsageError('--data-dir needs a directory');
  const dataDir =
    dataDirValue === undefined
      ? values['persist']
        ? context.cwd
        : undefined
      : path.resolve(context.cwd, dataDirValue);

  const apiToken = context.env[ENVIRONMENT.apiToken];
  if (apiToken !== undefined && !/^\S+$/.test(apiToken)) {
    throw new UsageError(
      `${ENVIRONMENT.apiToken} must be a non-empty value without whitespace`,
    );
  }

  const config: ServerConfig = {
    host,
    smtpPort: parsePort(values, 'smtp-port', DEFAULT_SMTP_PORT),
    apiPort: parsePort(values, 'api-port', DEFAULT_API_PORT),
    tls,
    ...(tlsCertFile && { tlsCertFile, tlsKeyFile }),
    ...(credentials && { credentials }),
    allowInsecureAuth,
    ...(dataDir && { dataDir }),
    limits,
    maxSmtpClients: DEFAULT_MAX_SMTP_CLIENTS,
    ...(apiToken && { apiToken }),
    httpAllowedHosts: listValue(values, 'http-allowed-host').map((value) =>
      parseAllowedHost(value),
    ),
    httpAllowedOrigins: listValue(values, 'http-allowed-origin').map((value) =>
      parseAllowedOrigin(value),
    ),
  };
  assertExposureIsProtected(config);
  return { kind: 'run', config };
}

type Values = Record<
  string,
  string | boolean | (string | boolean)[] | undefined
>;

function parseStrict(argv: readonly string[]) {
  const options: Record<
    string,
    { type: 'string' | 'boolean'; short?: string; multiple?: boolean }
  > = {};
  for (const spec of SERVER_OPTIONS) {
    options[spec.name] = {
      type: spec.type,
      ...(spec.short && { short: spec.short }),
      ...(spec.multiple && { multiple: true }),
    };
  }
  try {
    const result = parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    return { values: result.values as Values, tokens: result.tokens };
  } catch (error) {
    throw new UsageError(
      (error as Error).message.replace(/\. To specify .*$/s, ''),
    );
  }
}

function assertNoRepeats(
  tokens: readonly { kind: string; name?: string }[],
): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option' || !token.name) continue;
    const spec = SERVER_OPTIONS.find((option) => option.name === token.name);
    if (spec?.multiple) continue;
    if (seen.has(token.name)) {
      throw new UsageError(`--${token.name} was given more than once`);
    }
    seen.add(token.name);
  }
}

function stringValue(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function listValue(values: Values, name: string): string[] {
  const value = values[name];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function parsePort(values: Values, name: string, fallback: number): number {
  const value = stringValue(values, name);
  if (value === undefined) return fallback;
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65_535) {
    throw new UsageError(
      `--${name} must be a whole number from 0 to 65535, got "${value}"`,
    );
  }
  return Number(value);
}

function parseCount(values: Values, name: string, fallback: number): number {
  const value = stringValue(values, name);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new UsageError(
      `--${name} must be a positive whole number, got "${value}"`,
    );
  }
  return number;
}

function parseTlsMode(value: string): TlsMode {
  if (!(TLS_MODES as readonly string[]).includes(value)) {
    throw new UsageError(
      `--tls must be one of ${TLS_MODES.join(', ')}, got "${value}"`,
    );
  }
  return value as TlsMode;
}

const HOSTNAME =
  /^(?=.{1,253}$)[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/i;

function parseHost(value: string): string {
  const host =
    value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    throw new UsageError(
      `--host must be an IP address or host name, got "${value}"`,
    );
  }
  return host;
}

/** Whether an address only accepts connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.'))
  );
}

function parseAllowedHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^(\[[\da-f:.]+\]|[a-z\d.-]+)(:\d{1,5})?$/.test(host)) {
    throw new UsageError(
      `--http-allowed-host must be host or host:port, got "${value}"`,
    );
  }
  return host;
}

function parseAllowedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(
      `--http-allowed-origin must be an origin, got "${value}"`,
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.origin !== value.replace(/\/$/, '')
  ) {
    throw new UsageError(
      `--http-allowed-origin must be scheme://host[:port] without a path, got "${value}"`,
    );
  }
  return url.origin;
}

function parseCredentials(
  values: Values,
  context: ParseContext,
): MailCredentials | undefined {
  const user = stringValue(values, 'auth-user');
  const passwordFile = stringValue(values, 'auth-password-file');
  const envPassword = context.env[ENVIRONMENT.authPassword];

  if (passwordFile !== undefined && envPassword !== undefined) {
    throw new UsageError(
      `Use either ${ENVIRONMENT.authPassword} or --auth-password-file, not both`,
    );
  }
  let password = envPassword;
  if (passwordFile !== undefined) {
    try {
      password = context.readFile(passwordFile).replace(/\r?\n$/, '');
    } catch (error) {
      throw new UsageError(
        `Cannot read --auth-password-file: ${(error as Error).message}`,
      );
    }
  }
  if (user === undefined) {
    if (passwordFile !== undefined) {
      throw new UsageError('--auth-password-file needs --auth-user');
    }
    // A password in the environment without --auth-user is not an error: it
    // may be meant for another tool.
    return undefined;
  }
  if (user === '') throw new UsageError('--auth-user must not be empty');
  if (!password) {
    throw new UsageError(
      `--auth-user needs a password in ${ENVIRONMENT.authPassword} or --auth-password-file`,
    );
  }
  return { user, password };
}

/**
 * Anything reachable from other machines must be protected: the REST API by
 * a token, SMTP by TLS and credentials. Insecure authentication is a local
 * development override only.
 */
function assertExposureIsProtected(config: ServerConfig): void {
  if (isLoopbackHost(config.host)) return;
  const problems: string[] = [];
  if (!config.apiToken) {
    problems.push(`set ${ENVIRONMENT.apiToken} to protect the REST API`);
  }
  if (config.tls === 'none') {
    problems.push('use --tls starttls or --tls implicit');
  }
  if (!config.credentials) {
    problems.push('require SMTP credentials with --auth-user');
  }
  if (config.allowInsecureAuth) {
    problems.push('drop --allow-insecure-auth, it is for loopback only');
  }
  if (problems.length > 0) {
    throw new UsageError(
      `--host ${config.host} accepts connections from other machines; ${problems.join('; ')}`,
    );
  }
}

/** The usage text, generated from {@link SERVER_OPTIONS}. */
/**
 * The server help. `withCommands` adds the subcommands of the main
 * mail-debugger binary.
 */
export function formatServerHelp(
  command = 'mail-debugger',
  withCommands = false,
): string {
  const rows = SERVER_OPTIONS.map((spec) => {
    const flag = `${spec.short ? `-${spec.short}, ` : ' '.repeat(4)}--${spec.name}${spec.value ? ` <${spec.value}>` : ''}`;
    const suffix =
      spec.default === undefined ? '' : ` (default: ${spec.default})`;
    return [flag, `${spec.description}${suffix}`] as const;
  });
  const width = Math.max(...rows.map(([flag]) => flag.length)) + 2;
  return [
    withCommands
      ? `Usage: ${command} [serve] [options]\n       ${command} cli [options] [command]`
      : `Usage: ${command} [options]`,
    '',
    'Fake SMTP server for development: catches every email and shows it in a',
    'web inbox and over a REST API.',
    '',
    ...(withCommands
      ? [
          'Commands:',
          '  serve  Start the server (the default)',
          `  cli    Read the inbox of a running server; see "${command} cli --help"`,
          '',
        ]
      : []),
    'Options:',
    ...rows.map(([flag, text]) => `  ${flag.padEnd(width)}${text}`),
    '',
    'Environment:',
    `  ${ENVIRONMENT.apiToken}      Bearer token required by the REST API`,
    `  ${ENVIRONMENT.authPassword}  Password of --auth-user`,
    '  LOG_LEVEL                    debug, info, warn or error',
    '  NODE_ENV=production          Log JSON lines instead of colored text',
    '',
  ].join('\n');
}
