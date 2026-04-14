import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SMTP_PORT = 2526;
const API_PORT = 3001;
const HEALTH_URL = `http://localhost:${API_PORT}/api/health`;

async function waitForHealth(
  url: string,
  timeoutMs = 15_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

let serverProcess: ChildProcess | undefined;

export async function setup() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.resolve(thisDir, '../../server/dist/main.mjs');

  serverProcess = spawn(
    'node',
    [
      serverPath,
      '--smtp-port',
      String(SMTP_PORT),
      '--api-port',
      String(API_PORT),
    ],
    { stdio: 'pipe' }
  );

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[server stderr]', data.toString());
  });

  await waitForHealth(HEALTH_URL);

  // Store the process PID so globalTeardown can kill it
  process.env['__SERVER_PID__'] = String(serverProcess.pid);

  // Store the reference for teardown
  (globalThis as Record<string, unknown>).__SERVER_PROCESS__ =
    serverProcess;
}

export async function teardown() {
  const proc = (globalThis as Record<string, unknown>)
    .__SERVER_PROCESS__ as ChildProcess | undefined;
  if (proc) {
    proc.kill('SIGTERM');
  }
}
