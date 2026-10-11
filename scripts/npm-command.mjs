// npm.cmd needs a shell on Windows. Invoke its JavaScript entry point
// directly instead, so paths containing shell metacharacters stay literal.
import fs from 'node:fs';
import path from 'node:path';

export function npmCommand(args) {
  if (process.platform !== 'win32') return { command: 'npm', args };

  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const base = directory.replace(/^"|"$/g, '');
    if (!base || !fs.existsSync(path.join(base, 'npm.cmd'))) continue;
    const cli = path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(cli)) {
      throw new Error(
        `Cannot find npm-cli.js beside ${path.join(base, 'npm.cmd')}`,
      );
    }
    return { command: process.execPath, args: [cli, ...args] };
  }
  throw new Error(
    'Cannot find npm.cmd on PATH; install npm before running this script',
  );
}
