import { parseConfig } from './config/parse-config.js';
import { createApiClient } from '@mail-debugger/api-client';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { deleteCommand } from './commands/delete.js';
import { deleteAllCommand } from './commands/delete-all.js';
import { healthCommand } from './commands/health.js';

/**
 * Run the CLI with the given argument list (without `node`/bin prefix, e.g.
 * `process.argv.slice(2)`).
 *
 * Exported so the main `mail-debugger` binary can dispatch via `--cli`, while
 * `mail-debugger-cli`-style standalone invocation still uses this same flow.
 */
export async function runCli(argv: string[]): Promise<void> {
  const config = parseConfig(argv);
  const client = createApiClient(config.apiUrl);

  if (config.mode === 'command' && config.command) {
    const { command, jsonOutput } = config;

    switch (command.name) {
      case 'list': {
        await listCommand(client, command.filter, jsonOutput);
        break;
      }
      case 'show': {
        if (command.id === undefined) {
          console.error('Usage: mail-debugger --cli show <id>');
          process.exit(1);
        }
        await showCommand(client, command.id, jsonOutput);
        break;
      }
      case 'delete': {
        if (command.id === undefined) {
          console.error('Usage: mail-debugger --cli delete <id>');
          process.exit(1);
        }
        await deleteCommand(client, command.id, jsonOutput);
        break;
      }
      case 'delete-all': {
        await deleteAllCommand(client, jsonOutput);
        break;
      }
      case 'health': {
        await healthCommand(client, jsonOutput);
        break;
      }
    }
  } else {
    const { startTui } = await import('./tui/app.js');
    await startTui(client, config.apiUrl);
  }
}
