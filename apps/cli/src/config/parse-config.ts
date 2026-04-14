import type { EmailFilter } from '../types.js';
import type { CliConfig, CommandName } from './types.js';
import { COMMAND_NAMES } from './types.js';

export function parseConfig(argv: string[]): CliConfig {
  const config: CliConfig = {
    apiUrl: 'http://localhost:3000',
    jsonOutput: false,
    mode: 'tui',
  };

  let commandName: CommandName | undefined;
  let id: number | undefined;
  const filter: EmailFilter = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (COMMAND_NAMES.includes(arg)) {
      commandName = arg as CommandName;
      config.mode = 'command';

      if (
        (commandName === 'show' || commandName === 'delete') &&
        i + 1 < argv.length &&
        !argv[i + 1].startsWith('--')
      ) {
        id = Number(argv[++i]);
        if (Number.isNaN(id)) {
          throw new TypeError(`Invalid email ID: ${argv[i]}`);
        }
      }
      continue;
    }

    switch (arg) {
      case '--api-url': {
        const url = argv[++i];
        if (!url) throw new Error('Missing value for --api-url');
        config.apiUrl = url;
        break;
      }
      case '--json': {
        config.jsonOutput = true;
        break;
      }
      case '--from': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --from');
        filter.from = val;
        break;
      }
      case '--to': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --to');
        filter.to = val;
        break;
      }
      case '--subject': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --subject');
        filter.subject = val;
        break;
      }
      case '--since': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --since');
        filter.since = val;
        break;
      }
      case '--until': {
        const val = argv[++i];
        if (!val) throw new Error('Missing value for --until');
        filter.until = val;
        break;
      }
    }
  }

  if (commandName) {
    const hasFilter = Object.keys(filter).length > 0;
    config.command = {
      name: commandName,
      ...(id !== undefined && { id }),
      ...(hasFilter && { filter }),
    };
  }

  return config;
}
