import {
  createApiClient,
  getErrorMessage,
  type ApiClient,
} from '@mail-debugger/client';
import { deleteAllCommand } from './commands/delete-all.js';
import { deleteCommand } from './commands/delete.js';
import { healthCommand } from './commands/health.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { waitCommand } from './commands/wait.js';
import { formatHelp, parseConfig, UsageError } from './config/parse-config.js';
import { terminalLine } from './formatter/terminal-safe.js';
import type { CliCommand } from './config/types.js';

export interface CliProgram {
  /** Command line shown in help and messages, e.g. "mail-debugger cli". */
  name: string;
  version: string;
}

/**
 * Runs the CLI with the arguments after the program name and resolves to
 * the exit code: 0 on success, 1 on errors and wait timeouts, 2 on usage
 * errors. Results go to stdout, errors to stderr. Without a command it
 * starts the interactive inbox, which needs a terminal.
 */
export async function runCli(
  argv: readonly string[],
  program: CliProgram,
): Promise<number> {
  let config;
  try {
    config = parseConfig(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(
      `${program.name}: ${error.message}\nRun "${program.name} --help" for usage.\n`,
    );
    return 2;
  }

  switch (config.mode) {
    case 'help': {
      process.stdout.write(formatHelp(program.name));
      return 0;
    }
    case 'version': {
      process.stdout.write(`${program.version}\n`);
      return 0;
    }
    case 'tui': {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write(
          `${program.name}: the interactive inbox needs a terminal; give a command such as "list" (see --help)\n`,
        );
        return 2;
      }
      const tui = await loadInteractiveInbox(program.name);
      if (!tui) return 1;
      await tui.startTui(createClient(config.apiUrl), config.apiUrl);
      return 0;
    }
    case 'command': {
      try {
        return await runCommand(
          createClient(config.apiUrl),
          config.command,
          config.json,
        );
      } catch (error) {
        process.stderr.write(
          `${program.name}: ${terminalLine(getErrorMessage(error))}\n`,
        );
        return 1;
      }
    }
  }
}

/**
 * Loads the interactive inbox and its native terminal engine before it
 * touches the terminal. Where the engine has no prebuilt binary, explains
 * that and resolves to undefined; the commands work without it.
 */
async function loadInteractiveInbox(name: string) {
  try {
    const tui = await import('./tui/app.js');
    await tui.loadTerminalEngine();
    return tui;
  } catch (error) {
    const reason = getErrorMessage(error).split('\n', 1)[0] ?? '';
    process.stderr.write(
      `${name}: the interactive inbox cannot start on ${process.platform}-${process.arch}: ${terminalLine(reason)}\n` +
        'The commands (see --help) and the web inbox work without it.\n',
    );
    return;
  }
}

/** A client that sends MAIL_DEBUGGER_API_TOKEN, never a token argument. */
function createClient(apiUrl: string): ApiClient {
  const token = process.env['MAIL_DEBUGGER_API_TOKEN'];
  return createApiClient(apiUrl, token ? { token } : {});
}

async function runCommand(
  client: ApiClient,
  command: CliCommand,
  json: boolean,
): Promise<number> {
  switch (command.name) {
    case 'list': {
      const { filter, limit, offset } = command;
      await listCommand(
        client,
        {
          ...(filter && { filter }),
          ...(limit !== undefined && { limit }),
          ...(offset !== undefined && { offset }),
        },
        json,
      );
      return 0;
    }
    case 'show': {
      await showCommand(client, command.id, json);
      return 0;
    }
    case 'delete': {
      await deleteCommand(client, command.id, json);
      return 0;
    }
    case 'delete-all': {
      await deleteAllCommand(client, json);
      return 0;
    }
    case 'health': {
      await healthCommand(client, json);
      return 0;
    }
    case 'wait': {
      return waitCommand(client, command, json);
    }
  }
}
