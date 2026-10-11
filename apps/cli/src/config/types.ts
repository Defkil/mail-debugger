import type { EmailFilter } from '@mail-debugger/client';

export const COMMAND_NAMES = [
  'list',
  'show',
  'delete',
  'delete-all',
  'health',
  'wait',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export type CliCommand =
  | { name: 'list'; filter?: EmailFilter; limit?: number; offset?: number }
  | { name: 'show' | 'delete'; id: number }
  | { name: 'delete-all' | 'health' }
  | {
      name: 'wait';
      filter?: EmailFilter;
      /** Without one, the wait starts at the current high watermark. */
      afterId?: number;
      mailboxId?: string;
      timeoutMs: number;
    };

export type CliConfig =
  | { mode: 'help' }
  | { mode: 'version' }
  | { mode: 'tui'; apiUrl: string }
  | { mode: 'command'; apiUrl: string; json: boolean; command: CliCommand };
