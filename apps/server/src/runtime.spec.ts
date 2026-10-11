import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createTransport } from 'nodemailer';
import { parseServerArgs } from './config.js';
import { LOCK_FILE } from './db/persistence.js';
import { startServer, StartupError, type RunningServer } from './runtime.js';
import { silentLogger } from './testing/mail-fixtures.js';
import type { ServerConfig } from './types.js';

function config(argv: string[] = []): ServerConfig {
  const defaults = [
    ...(argv.includes('--smtp-port') ? [] : ['--smtp-port', '0']),
    ...(argv.includes('--api-port') ? [] : ['--api-port', '0']),
  ];
  const command = parseServerArgs([...defaults, ...argv], {
    env: {},
    cwd: process.cwd(),
    readFile: () => '',
  });
  if (command.kind !== 'run') throw new Error('expected a run command');
  return command.config;
}

async function occupy(): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function portOf(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

async function send(server: RunningServer, subject: string) {
  await createTransport({
    host: '127.0.0.1',
    port: server.smtp.port,
    secure: false,
  }).sendMail({
    from: 'a@example.com',
    to: 'b@example.com',
    subject,
    text: 'x',
  });
}

async function health(server: RunningServer) {
  const response = await fetch(
    `http://127.0.0.1:${server.http.port}/api/health`,
  );
  return (await response.json()) as Record<string, unknown>;
}

describe('startServer', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-runtime-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('binds loopback, reports the bound ports and closes idempotently', async () => {
    const server = await startServer(config(), { logger: silentLogger });
    expect(server.smtp.address).toBe('127.0.0.1');
    expect(server.smtp.port).toBeGreaterThan(0);
    expect(server.http.port).toBeGreaterThan(0);
    await send(server, 'hello');
    expect(await health(server)).toMatchObject({
      smtpPort: server.smtp.port,
      apiPort: server.http.port,
      emailCount: 1,
    });

    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
    await expect(health(server)).rejects.toThrow();
  });

  it('fails with a clear error and cleans up when the SMTP port is taken', async () => {
    const blocker = await occupy();
    try {
      const starting = startServer(
        config(['--smtp-port', String(portOf(blocker)), '--data-dir', dataDir]),
        { logger: silentLogger },
      );
      await expect(starting).rejects.toBeInstanceOf(StartupError);
      await expect(starting).rejects.toThrow(/already in use.*--smtp-port/);
      expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false);
    } finally {
      blocker.close();
    }
  });

  it('closes the SMTP listener again when the HTTP port is taken', async () => {
    const blocker = await occupy();
    const smtpBlocker = await occupy();
    const smtpPort = portOf(smtpBlocker);
    await new Promise((resolve) => smtpBlocker.close(resolve));
    try {
      await expect(
        startServer(
          config([
            '--smtp-port',
            String(smtpPort),
            '--api-port',
            String(portOf(blocker)),
            '--data-dir',
            dataDir,
          ]),
          { logger: silentLogger },
        ),
      ).rejects.toThrow(/HTTP port .* already in use.*--api-port/);
      // The SMTP port is free again.
      const probe = net.createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(smtpPort, '127.0.0.1', resolve);
      });
      probe.close();
      expect(fs.existsSync(path.join(dataDir, LOCK_FILE))).toBe(false);
    } finally {
      blocker.close();
    }
  });

  it('keeps identity, ids and mail across a restart', async () => {
    const first = await startServer(config(['--data-dir', dataDir]), {
      logger: silentLogger,
    });
    await send(first, 'one');
    await send(first, 'two');
    first.service.delete(2, 'rest');
    const identity = first.service.identity();
    await first.close();

    const second = await startServer(config(['--data-dir', dataDir]), {
      logger: silentLogger,
    });
    try {
      expect(second.service.identity()).toEqual(identity);
      expect(second.service.highWatermark()).toBe(2);
      await send(second, 'three');
      expect(
        second.service.list(undefined).data.map((e) => [e.id, e.subject]),
      ).toEqual([
        [3, 'three'],
        [1, 'one'],
      ]);
    } finally {
      await second.close();
    }
  });

  it('refuses a data directory that a running server uses', async () => {
    const first = await startServer(config(['--data-dir', dataDir]), {
      logger: silentLogger,
    });
    try {
      await expect(
        startServer(config(['--data-dir', dataDir]), { logger: silentLogger }),
      ).rejects.toThrow(/in use by process/);
    } finally {
      await first.close();
    }
  });

  it('refuses new mail during shutdown', async () => {
    const server = await startServer(config(), { logger: silentLogger });
    const closing = server.close();
    await expect(send(server, 'late')).rejects.toThrow();
    await closing;
  });
});
