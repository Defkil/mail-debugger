import pino from 'pino';

export function createLogger() {
  const isDev = process.env['NODE_ENV'] !== 'production';

  return pino({
    level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

export type Logger = pino.Logger;
