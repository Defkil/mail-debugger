import type { EmailFilter } from '../types.js';

const COMMANDS = ['list', 'show', 'delete', 'delete-all', 'health'] as const;
export type CommandName = (typeof COMMANDS)[number];
export const COMMAND_NAMES: readonly string[] = COMMANDS;

export interface CliCommand {
  name: CommandName;
  id?: number;
  filter?: EmailFilter;
}

export interface CliConfig {
  apiUrl: string;
  jsonOutput: boolean;
  mode: 'tui' | 'command';
  command?: CliCommand;
}
