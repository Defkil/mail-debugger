import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { api, sendMail } from '../helpers/mail.js';
import {
  BINARIES,
  makeTempDir,
  removeTempDirs,
  runBinary,
  startServerProcess,
  stopAllServers,
} from '../helpers/server.js';

afterAll(async () => {
  await stopAllServers();
  removeTempDirs();
});

describe('command line', () => {
  it('prints help without opening any listener', async () => {
    const result = await runBinary(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: mail-debugger [serve] [options]');
    expect(result.stdout).toContain('mail-debugger cli [options] [command]');
    expect(result.stdout).toContain('mail-debugger mcp [--url <url>]');
    expect(result.stdout).toContain('--data-dir <dir>');
    expect(result.stderr).toBe('');
  });

  it('accepts serve as the explicit server command', async () => {
    const result = await runBinary(['serve', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--data-dir <dir>');

    const server = await startServerProcess({ args: ['serve'] });
    expect((await api(server.baseUrl, '/api/health')).status).toBe(200);
    expect(await server.stop()).toBe(0);
  });

  it.each([['frobnicate'], ['--cli']])(
    'rejects the command %s with exit code 2',
    async (command) => {
      const result = await runBinary([command]);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/Unknown (command|option)/);
    },
  );

  it.each([
    { binary: BINARIES.full, args: ['bad\u{1B}]52;c;payload\u{7}'] },
    { binary: BINARIES.full, args: ['--smtp-port', '\u{9B}31m'] },
    { binary: BINARIES.api, args: ['--smtp-port', '\u{1B}[31m'] },
  ])(
    'sanitizes server usage diagnostics ($binary, $args)',
    async ({ binary, args }) => {
      const result = await runBinary(args, { binary });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('\u{FFFD}');
      expect(result.stderr).not.toContain('\u{1B}');
      expect(result.stderr).not.toContain('\u{9B}');
      expect(result.stderr).not.toContain('\u{7}');
    },
  );

  it('prints the version', async () => {
    const result = await runBinary(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('names itself in the slim distribution', async () => {
    const result = await runBinary(['--help'], { binary: BINARIES.api });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: mail-debugger-api [options]');
  });

  it.each([
    [['--smtp-prot', '25'], /Unknown option '--smtp-prot'/],
    [['--smtp-port', '1.5'], /--smtp-port must be a whole number/],
    [['--tls'], /argument missing/],
    [['--tls', 'none', '--tls', 'implicit'], /--tls was given more than once/],
    [['--host', '0.0.0.0'], /accepts connections from other machines/],
  ])('rejects %j with exit code 2', async (args, message) => {
    const result = await runBinary(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain('--help');
  });

  it('exits with code 1 when a port is in use', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, '127.0.0.1', resolve),
    );
    try {
      const port = (blocker.address() as net.AddressInfo).port;
      const result = await runBinary([
        '--smtp-port',
        String(port),
        '--api-port',
        '0',
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toMatch(
        new RegExp(`SMTP port ${port} on 127.0.0.1 is already in use`),
      );
    } finally {
      blocker.close();
    }
  });
});

describe('lifecycle', () => {
  it('stops gracefully with exit code 0', async () => {
    const server = await startServerProcess();
    expect(await server.stop()).toBe(0);
    expect(server.output()).toContain('Stopped');
  });

  it('keeps mail, ids and the persistent flag across a restart', async () => {
    const dataDir = makeTempDir();
    const first = await startServerProcess({ args: ['--data-dir', dataDir] });
    await sendMail({ port: first.smtpPort }, { subject: 'kept' });
    await sendMail({ port: first.smtpPort }, { subject: 'deleted' });
    await api(first.baseUrl, '/api/emails/2', { method: 'DELETE' });
    expect(await first.stop()).toBe(0);

    const second = await startServerProcess({ args: ['--data-dir', dataDir] });
    const health = (await api(second.baseUrl, '/api/health')).body;
    expect(health).toMatchObject({ persistent: true, emailCount: 1 });
    await sendMail({ port: second.smtpPort }, { subject: 'new' });
    const { body } = await api(second.baseUrl, '/api/emails');
    expect(
      body.data.map((e: { id: number; subject: string }) => [e.id, e.subject]),
    ).toEqual([
      [3, 'new'],
      [1, 'kept'],
    ]);
    await second.stop();
  }, 30_000);

  it('refuses a data directory that another server uses', async () => {
    const dataDir = makeTempDir();
    const first = await startServerProcess({ args: ['--data-dir', dataDir] });
    const result = await runBinary([
      '--data-dir',
      dataDir,
      '--smtp-port',
      '0',
      '--api-port',
      '0',
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/in use by process/);
    await first.stop();
  }, 30_000);

  it('keeps the last snapshot after a forced kill', async () => {
    const dataDir = makeTempDir();
    const first = await startServerProcess({ args: ['--data-dir', dataDir] });
    await sendMail({ port: first.smtpPort }, { subject: 'snapshotted' });
    // Snapshots follow changes after 250 ms.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    first.child.kill('SIGKILL');
    await new Promise((resolve) => first.child.once('exit', resolve));
    // The lock of the killed process stays behind and is taken over.
    expect(fs.existsSync(path.join(dataDir, 'mail-debugger.lock'))).toBe(true);

    const second = await startServerProcess({ args: ['--data-dir', dataDir] });
    const { body } = await api(second.baseUrl, '/api/emails');
    expect(body.data.map((e: { subject: string }) => e.subject)).toEqual([
      'snapshotted',
    ]);
    await second.stop();
  }, 30_000);

  it('migrates a mail-debugger 0.3 database and keeps a backup', async () => {
    const dataDir = makeTempDir();
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL, cc TEXT, bcc TEXT, subject TEXT, text_body TEXT,
      html_body TEXT, raw TEXT NOT NULL, headers TEXT, attachments TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    legacy.run(
      `INSERT INTO emails (from_addr, to_addr, subject, text_body, raw, received_at)
       VALUES ('old@example.com', '["you@example.com"]', 'from 0.3', 'body',
               'Subject: from 0.3\r\n\r\nbody', '2026-04-01 08:15:00')`,
    );
    fs.writeFileSync(
      path.join(dataDir, 'mail-debugger.sqlite'),
      legacy.export(),
    );
    legacy.close();

    const server = await startServerProcess({ args: ['--data-dir', dataDir] });
    const { body } = await api(server.baseUrl, '/api/emails/1');
    expect(body.data).toMatchObject({
      from: 'old@example.com',
      subject: 'from 0.3',
      receivedAt: '2026-04-01T08:15:00.000Z',
      raw: 'Subject: from 0.3\r\n\r\nbody',
    });
    expect(server.output()).toMatch(/Migrated the stored mail/);
    expect(
      fs.existsSync(path.join(dataDir, 'mail-debugger.sqlite.schema1.bak')),
    ).toBe(true);
    await server.stop();
  }, 30_000);
});
