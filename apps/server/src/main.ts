import path from 'node:path';
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
  process.stderr.write(
    `${NAME}: Unknown command "${command}"\nRun "${NAME} --help" for usage.\n`,
  );
  process.exitCode = 2;
}
