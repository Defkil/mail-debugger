import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  /**
   * Where log lines go. The stdio MCP bridge logs to stderr because stdout
   * carries the protocol. Defaults to stdout.
   */
  destination?: 'stdout' | 'stderr';
  /** Pretty, colored lines instead of JSON. Defaults to `NODE_ENV !== 'production'`. */
  pretty?: boolean;
  /** Minimum level. Defaults to `LOG_LEVEL`, else debug (pretty) or info (JSON). */
  level?: string;
}

/** Values that must never reach a log line, however they are nested. */
const REDACTED_PATHS = [
  'password',
  'pass',
  'token',
  'authorization',
  '*.password',
  '*.pass',
  '*.token',
  '*.authorization',
];

export function createLogger(options: LoggerOptions = {}): Logger {
  const pretty = options.pretty ?? process.env['NODE_ENV'] !== 'production';
  const level =
    options.level ?? process.env['LOG_LEVEL'] ?? (pretty ? 'debug' : 'info');
  const fd = options.destination === 'stderr' ? 2 : 1;
  const redact = { paths: REDACTED_PATHS, censor: '[redacted]' };

  if (pretty) {
    return pino({
      level,
      redact,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          destination: fd,
        },
      },
    });
  }
  return pino({ level, redact }, pino.destination({ fd, sync: false }));
}
