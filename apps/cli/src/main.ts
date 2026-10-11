import { readFileSync } from 'node:fs';
import { runCli } from './run-cli.js';

/** Version from the manifest next to the bundle (packages/cli/package.json). */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  name: 'mail-debugger-cli',
  version: packageVersion(),
});
