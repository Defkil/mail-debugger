import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Built entry points of the distributions under test. */
export const BINARIES = {
  full: path.resolve(here, '../../../server/dist/main.mjs'),
  api: path.resolve(here, '../../../server/dist-api/main.mjs'),
  /** The legacy mail-debugger-cli distribution. */
  cli: path.resolve(here, '../../../../packages/cli/dist/main.mjs'),
} as const;

export interface ServerProcess {
  readonly child: ChildProcess;
  readonly smtpPort: number;
  readonly apiPort: number;
  /** Bound IMAP port when the server runs with --imap. */
  readonly imapPort?: number;
  /** Base URL of the HTTP server, e.g. http://127.0.0.1:41234 */
  readonly baseUrl: string;
  /** Everything the process wrote so far. */
  output(): string;
  /** Graceful stop (IPC shutdown message) with a forced kill after `timeoutMs`. */
  stop(timeoutMs?: number): Promise<number | null>;
}

export interface StartOptions {
  args?: string[];
  env?: Record<string, string>;
  binary?: string;
  cwd?: string;
  timeoutMs?: number;
}

const running = new Set<ServerProcess>();

/**
 * Spawns the built server on free ports and waits for its "ready" log line,
 * which carries the bound ports. A start timeout or an early exit fails with
 * the process output.
 */
export async function startServerProcess(
  options: StartOptions = {},
): Promise<ServerProcess> {
  const args = [...(options.args ?? [])];
  if (!args.includes('--smtp-port')) args.push('--smtp-port', '0');
  if (!args.includes('--api-port')) args.push('--api-port', '0');
  if (args.includes('--imap') && !args.includes('--imap-port')) {
    args.push('--imap-port', '0');
  }

  const child = spawn(
    process.execPath,
    [options.binary ?? BINARIES.full, ...args],
    {
      cwd: options.cwd ?? os.tmpdir(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => resolve(code)),
  );

  const timeoutMs = options.timeoutMs ?? 20_000;
  const ready = await new Promise<{
    smtpPort: number;
    apiPort: number;
    imapPort?: number;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Server did not become ready within ${timeoutMs} ms:\n${output}`,
        ),
      );
    }, timeoutMs);
    const check = () => {
      const lines = output.split('\n');
      lines.pop(); // the last segment may be an incomplete line
      for (const line of lines) {
        if (!line.includes('mail-debugger is ready')) continue;
        const entry = JSON.parse(line) as {
          smtpPort: number;
          apiPort: number;
          imapPort?: number;
        };
        clearTimeout(timer);
        child.stdout?.off('data', check);
        resolve({
          smtpPort: entry.smtpPort,
          apiPort: entry.apiPort,
          ...(entry.imapPort !== undefined && { imapPort: entry.imapPort }),
        });
        return;
      }
    };
    child.stdout?.on('data', check);
    void exited.then((code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Server exited with code ${code} before it was ready:\n${output}`,
        ),
      );
    });
  });

  const server: ServerProcess = {
    child,
    ...ready,
    baseUrl: `http://127.0.0.1:${ready.apiPort}`,
    output: () => output,
    async stop(stopTimeoutMs = 10_000) {
      running.delete(server);
      if (child.exitCode !== null) return child.exitCode;
      if (child.connected) child.send('shutdown');
      else child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), stopTimeoutMs);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
  running.add(server);
  return server;
}

/** Stops every server a test file started and did not stop itself. */
export async function stopAllServers(): Promise<void> {
  await Promise.all([...running].map((server) => server.stop()));
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a short-lived command of a built binary to completion. */
export function runBinary(
  args: string[],
  options: {
    binary?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [options.binary ?? BINARIES.full, ...args],
      {
        cwd: os.tmpdir(),
        env: { ...process.env, NODE_ENV: 'production', ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out: ${args.join(' ')}\n${stdout}${stderr}`));
    }, options.timeoutMs ?? 20_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** A fresh temporary directory, removed by {@link removeTempDirs}. */
const tempDirs: string[] = [];
export function makeTempDir(prefix = 'mail-debugger-e2e-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Polls `assertion` until it passes or `timeoutMs` elapses. */
export async function eventually<T>(
  assertion: () => Promise<T> | T,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await assertion();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
