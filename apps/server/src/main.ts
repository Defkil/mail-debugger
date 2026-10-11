import path from 'node:path';
import { UsageError } from './config.js';
import { runServerProgram } from './run-server.js';
import { getVersion } from './version.js';

const NAME = 'mail-debugger';
const argv = process.argv.slice(2);
const [command, ...rest] = argv;

if (command === 'cli') {
  // Loaded on demand: starting the server never loads the CLI.
  // eslint-disable-next-line @nx/enforce-module-boundaries -- the main binary embeds the CLI app as its "cli" command
  const { runCli } = await import('@mail-debugger/cli/run-cli');
  process.exitCode = await runCli(rest, {
    name: `${NAME} cli`,
    version: getVersion(),
  });
} else if (command === 'mcp') {
  // Loaded on demand: the stdio bridge opens no mailbox and no listener.
  const { runMcpBridge } = await import('./mcp/bridge.js');
  process.exitCode = await runMcpBridge(rest, {
    name: `${NAME} mcp`,
    version: getVersion(),
  });
  // Lingering handles of the SDK transports must not keep a finished bridge
  // alive; the delay lets pending output reach the pipes first.
  setTimeout(() => process.exit(), 1000).unref();
} else if (
  command === undefined ||
  command === 'serve' ||
  command.startsWith('-')
) {
  await runServerProgram(command === 'serve' ? rest : argv, {
    name: NAME,
    webDir: path.join(import.meta.dirname, 'web'),
    withCommands: true,
  });
} else {
  const error = new UsageError(`Unknown command "${command}"`);
  process.stderr.write(
    `${NAME}: ${error.message}\nRun "${NAME} --help" for usage.\n`,
  );
  process.exitCode = 2;
}
