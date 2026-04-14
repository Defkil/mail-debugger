import type { Config } from './types.js';

export function parseConfig(argv: string[]): Config {
  const config: Config = {
    smtpPort: 2525,
    apiPort: 3000,
    persist: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--smtp-port': {
        const port = Number(argv[++i]);
        if (isNaN(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid SMTP port: ${argv[i]}`);
        }
        config.smtpPort = port;
        break;
      }
      case '--api-port': {
        const port = Number(argv[++i]);
        if (isNaN(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid API port: ${argv[i]}`);
        }
        config.apiPort = port;
        break;
      }
      case '--persist':
        config.persist = true;
        break;
    }
  }

  return config;
}
