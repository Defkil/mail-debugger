import path from 'node:path';
import { runServerProgram } from './run-server.js';

void runServerProgram(process.argv.slice(2), {
  name: 'mail-debugger',
  webDir: path.join(import.meta.dirname, 'web'),
});
