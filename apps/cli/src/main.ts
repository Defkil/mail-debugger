import { getErrorMessage } from './error.js';
import { runCli } from './run-cli.js';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
