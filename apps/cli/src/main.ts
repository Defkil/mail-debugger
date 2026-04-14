import { parseConfig } from './config.js';
import { createApiClient } from './api/client.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { deleteCommand } from './commands/delete.js';
import { deleteAllCommand } from './commands/delete-all.js';
import { healthCommand } from './commands/health.js';

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const client = createApiClient(config.apiUrl);

  if (config.mode === 'command' && config.command) {
    const { command, jsonOutput } = config;

    switch (command.name) {
      case 'list':
        await listCommand(client, command.filter, jsonOutput);
        break;
      case 'show':
        if (command.id === undefined) {
          console.error('Usage: mail-debugger-cli show <id>');
          process.exit(1);
        }
        await showCommand(client, command.id, jsonOutput);
        break;
      case 'delete':
        if (command.id === undefined) {
          console.error('Usage: mail-debugger-cli delete <id>');
          process.exit(1);
        }
        await deleteCommand(client, command.id, jsonOutput);
        break;
      case 'delete-all':
        await deleteAllCommand(client, jsonOutput);
        break;
      case 'health':
        await healthCommand(client, jsonOutput);
        break;
    }
  } else {
    // TUI mode - dynamic import to avoid loading Rezi for command mode
    const { startTui } = await import('./tui/app.js');
    await startTui(client);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
