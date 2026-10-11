import { runServerProgram } from './run-server.js';

/**
 * API-only entry point. Same wire protocol as `mail-debugger`, without the
 * embedded web UI. Published as `mail-debugger-api` for slim CI/E2E usage.
 */
void runServerProgram(process.argv.slice(2), { name: 'mail-debugger-api' });
