import type { Config, TlsMode } from './types.js';

const VALID_TLS_MODES: TlsMode[] = ['none', 'starttls', 'implicit'];

export function parseConfig(argv: string[]): Config {
  const config: Config = {
    smtpPort: 2525,
    apiPort: 3000,
    tls: 'none',
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
      case '--tls': {
        const mode = argv[++i] as TlsMode;
        if (!VALID_TLS_MODES.includes(mode)) {
          throw new Error(
            `Invalid TLS mode: "${mode}" (valid: ${VALID_TLS_MODES.join(', ')})`
          );
        }
        config.tls = mode;
        break;
      }
      case '--persist':
        config.persist = true;
        break;
    }
  }

  return config;
}
