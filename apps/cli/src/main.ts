import { getErrorMessage } from '@mail-debugger/api-client';
import { runCli } from './run-cli.js';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
