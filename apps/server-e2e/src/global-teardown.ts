import type { ChildProcess } from 'child_process';

export default async function globalTeardown() {
  const proc = (globalThis as Record<string, unknown>)
    .__SERVER_PROCESS__ as ChildProcess | undefined;
  if (proc) {
    proc.kill('SIGTERM');
  }
}
