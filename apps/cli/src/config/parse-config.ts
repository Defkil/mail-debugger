import { parseArgs } from 'node:util';
import { normalizeBaseUrl, pickEmailFilter } from '@mail-debugger/client';
import { COMMAND_NAMES, type CliConfig, type CommandName } from './types.js';

export const DEFAULT_API_URL = 'http://127.0.0.1:3000';
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
/** Longest total wait of the wait command (it waits in server-sized steps). */
export const MAX_WAIT_TIMEOUT_MS = 3_600_000;

/** A command line the CLI cannot run; exits with status 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const OPTIONS = {
  'api-url': { type: 'string' },
  json: { type: 'boolean' },
  from: { type: 'string' },
  to: { type: 'string' },
  subject: { type: 'string' },
  since: { type: 'string' },
  until: { type: 'string' },
  limit: { type: 'string' },
  offset: { type: 'string' },
  'after-id': { type: 'string' },
  'mailbox-id': { type: 'string' },
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type OptionName = keyof typeof OPTIONS;

const FILTER_OPTIONS: OptionName[] = [
  'from',
  'to',
  'subject',
  'since',
  'until',
];

/** Options of each command besides --api-url and --json. */
const COMMAND_OPTIONS: Record<CommandName, readonly OptionName[]> = {
  list: [...FILTER_OPTIONS, 'limit', 'offset'],
  wait: [...FILTER_OPTIONS, 'after-id', 'mailbox-id', 'timeout'],
  show: [],
  delete: [],
  'delete-all': [],
  health: [],
};

/**
 * Parses the CLI arguments (without the program name). Unknown, repeated
 * or misplaced options, missing values and invalid numbers are
 * {@link UsageError}s.
 */
export function parseConfig(argv: readonly string[]): CliConfig {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals, tokens } = parsed;

  const given = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (given.has(token.name)) {
      throw new UsageError(`--${token.name} was given more than once`);
    }
    given.add(token.name);
  }
  if (values.help) return { mode: 'help' };
  if (values.version) return { mode: 'version' };

  const apiUrl = parseApiUrl(values['api-url'] ?? DEFAULT_API_URL);
  const [name, ...rest] = positionals;
  if (name === undefined) {
    const misplaced = [...given].find((option) => option !== 'api-url');
    if (misplaced) throw new UsageError(`--${misplaced} needs a command`);
    return { mode: 'tui', apiUrl };
  }
  if (!isCommandName(name)) throw new UsageError(`Unknown command "${name}"`);

  const allowed = new Set<string>([
    'api-url',
    'json',
    ...COMMAND_OPTIONS[name],
  ]);
  const misplaced = [...given].find((option) => !allowed.has(option));
  if (misplaced) {
    throw new UsageError(`--${misplaced} does not apply to "${name}"`);
  }
  const needsId = name === 'show' || name === 'delete';
  if (rest.length !== (needsId ? 1 : 0)) {
    throw new UsageError(
      needsId
        ? `"${name}" needs exactly one email id`
        : `"${name}" takes no arguments, got "${rest.join(' ')}"`,
    );
  }

  const filter = pickEmailFilter(values);
  const base = { mode: 'command' as const, apiUrl, json: values.json ?? false };
  switch (name) {
    case 'list': {
      const limit = optionalInteger(values.limit, '--limit', 1, 200);
      const offset = optionalInteger(
        values.offset,
        '--offset',
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return {
        ...base,
        command: {
          name,
          ...(filter && { filter }),
          ...(limit !== undefined && { limit }),
          ...(offset !== undefined && { offset }),
        },
      };
    }
    case 'wait': {
      const afterId = optionalInteger(
        values['after-id'],
        '--after-id',
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const mailboxId = values['mailbox-id'];
      return {
        ...base,
        command: {
          name,
          timeoutMs:
            optionalInteger(
              values.timeout,
              '--timeout',
              0,
              MAX_WAIT_TIMEOUT_MS,
            ) ?? DEFAULT_WAIT_TIMEOUT_MS,
          ...(filter && { filter }),
          ...(afterId !== undefined && { afterId }),
          ...(mailboxId && { mailboxId }),
        },
      };
    }
    case 'show':
    case 'delete': {
      return {
        ...base,
        command: {
          name,
          id: integer(rest[0], 'email id', 1, Number.MAX_SAFE_INTEGER),
        },
      };
    }
    default: {
      return { ...base, command: { name } };
    }
  }
}

function isCommandName(name: string): name is CommandName {
  return (COMMAND_NAMES as readonly string[]).includes(name);
}

function parseApiUrl(value: string): string {
  try {
    if (value === '') throw new TypeError('The URL is empty');
    return normalizeBaseUrl(value);
  } catch (error) {
    throw new UsageError(`Invalid --api-url: ${(error as Error).message}`);
  }
}

function integer(value: string, name: string, min: number, max: number) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min || number > max) {
    throw new UsageError(
      `${name} must be a whole number from ${min} to ${max}`,
    );
  }
  return number;
}

function optionalInteger(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : integer(value, name, min, max);
}

export function formatHelp(program: string): string {
  return `Usage: ${program} [options] [command]

Reads the inbox of a running mail-debugger server. Without a command it
starts the interactive inbox, which needs a terminal.

Commands:
  list               List emails, newest first
  show <id>          Show one email
  delete <id>        Delete one email
  delete-all         Delete all emails
  health             Show the server status
  wait               Wait for the next matching email; exits with 1
                     when none arrives in time

Options:
  --api-url <url>    Server URL (default ${DEFAULT_API_URL})
  --json             Print JSON instead of text
  --from <text>      list, wait: sender contains text (case-insensitive)
  --to <text>        list, wait: a recipient contains text
  --subject <text>   list, wait: subject contains text
  --since <date>     list, wait: received at or after (YYYY-MM-DD or ISO 8601)
  --until <date>     list, wait: received at or before
  --limit <n>        list: page size, 1 to 200 (default 50)
  --offset <n>       list: emails to skip (default 0)
  --after-id <id>    wait: only emails with a higher id (default: the
                     newest id at the start, so only new emails count)
  --mailbox-id <id>  wait: fail if the server holds another mailbox
  --timeout <ms>     wait: how long to wait, up to ${MAX_WAIT_TIMEOUT_MS} (default ${DEFAULT_WAIT_TIMEOUT_MS})
  -h, --help         Show this help
  -v, --version      Show the version

Environment:
  MAIL_DEBUGGER_API_TOKEN  Bearer token for a server started with one

Exit status: 0 on success, 1 on errors and wait timeouts, 2 on usage errors.
`;
}
