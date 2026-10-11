import { getErrorMessage } from '@mail-debugger/client';
import { runCli } from './run-cli.js';

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exit(1);
  }
}

void main();
