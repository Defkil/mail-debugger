import { createApiClient, type ApiClient } from '@mail-debugger/client';
import { sendMail, type TestMail } from '../helpers/mail.js';
import {
  BINARIES,
  runBinary,
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

afterAll(async () => {
  await stopAllServers();
});

describe.each([
  { name: 'mail-debugger cli', binary: BINARIES.full, prefix: ['cli'] },
  { name: 'mail-debugger-cli', binary: BINARIES.cli, prefix: [] },
])('$name', ({ name, binary, prefix }) => {
  let server: ServerProcess;
  let client: ApiClient;

  beforeAll(async () => {
    server = await startServerProcess();
    client = createApiClient(server.baseUrl);
  }, 30_000);

  beforeEach(async () => {
    await client.deleteAllEmails();
  });

  const cli = (args: string[]) =>
    runBinary([...prefix, '--api-url', server.baseUrl, ...args], { binary });

  const send = (mail: TestMail = {}) =>
    sendMail({ port: server.smtpPort }, mail);

  it('lists, shows and deletes emails as JSON', async () => {
    await send({ subject: 'CLI test', to: 'cli@example.com' });

    const list = await cli(['list', '--json', '--to', 'CLI@']);
    expect(list).toMatchObject({ code: 0, stderr: '' });
    const emails = JSON.parse(list.stdout) as { id: number }[];
    expect(emails).toEqual([
      expect.objectContaining({ subject: 'CLI test', to: ['cli@example.com'] }),
    ]);
    const { id } = emails[0];

    const show = await cli(['show', String(id), '--json']);
    expect(show.code).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({
      id,
      subject: 'CLI test',
      textBody: expect.stringContaining('e2e test email body'),
    });

    const deleted = await cli(['delete', String(id), '--json']);
    expect(deleted.code).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual({ id, deleted: true });

    const missing = await cli(['show', String(id)]);
    expect(missing).toMatchObject({ code: 1, stdout: '' });
    expect(missing.stderr).toBe(`${name}: Email not found\n`);
  });

  it('prints text output', async () => {
    await send({ subject: 'Text output' });

    const list = await cli(['list', '--limit', '1']);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('Text output');
    const health = await cli(['health']);
    expect(health.code).toBe(0);
    expect(health.stdout).toContain(String(server.smtpPort));
  });

  it('reports health and deletes all emails', async () => {
    await send();
    await send();

    const health = await cli(['health', '--json']);
    expect(JSON.parse(health.stdout)).toMatchObject({
      status: 'ok',
      emailCount: 2,
    });
    const all = await cli(['delete-all', '--json']);
    expect(JSON.parse(all.stdout)).toEqual({ deleted: 2 });
  });

  it('waits for a matching email', async () => {
    await send({ subject: 'fresh but old' });
    const { highWatermark, mailboxId } = await client.listEmails({ limit: 1 });
    const pending = cli([
      'wait',
      '--json',
      '--subject',
      'FRESH',
      '--after-id',
      String(highWatermark),
      '--mailbox-id',
      String(mailboxId),
      '--timeout',
      '15000',
    ]);
    await send({ subject: 'not this one' });
    await send({ subject: 'Fresh mail' });

    const result = await pending;
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      timedOut: false,
      mailboxId,
      data: { id: Number(highWatermark) + 2, subject: 'Fresh mail' },
    });
  });

  it('exits with 1 when no email arrives in time', async () => {
    await send();
    const result = await cli(['wait', '--timeout', '300']);
    expect(result).toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'No matching email arrived within 300 ms.\n',
    });
  });

  it.each([
    [['frobnicate'], /Unknown command "frobnicate"/],
    [['list', '--bogus'], /Unknown option '--bogus'/],
    [['show'], /needs exactly one email id/],
    [['wait', '--timeout', 'soon'], /--timeout must be a whole number/],
    [[], /needs a terminal/],
  ])('rejects %j with exit code 2', async (args, message) => {
    const result = await cli(args);
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(result.stderr).toMatch(message);
  });

  it('prints help and the version', async () => {
    const help = await runBinary([...prefix, '--help'], { binary });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(`Usage: ${name} [options] [command]`);
    const version = await runBinary([...prefix, '--version'], { binary });
    expect(version.code).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CLI against a protected or missing server', () => {
  it('sends MAIL_DEBUGGER_API_TOKEN as the bearer token', async () => {
    const token = 'e2e-cli-token';
    const server = await startServerProcess({
      env: { MAIL_DEBUGGER_API_TOKEN: token },
    });
    const args = ['cli', '--api-url', server.baseUrl, 'health', '--json'];

    const denied = await runBinary(args, {
      env: { MAIL_DEBUGGER_API_TOKEN: '' },
    });
    expect(denied.code).toBe(1);
    expect(denied.stderr).toMatch(/token/i);
    const allowed = await runBinary(args, {
      env: { MAIL_DEBUGGER_API_TOKEN: token },
    });
    expect(allowed.code).toBe(0);
    expect(JSON.parse(allowed.stdout)).toMatchObject({ status: 'ok' });
  });

  it('exits with 1 when the server is not reachable', async () => {
    const server = await startServerProcess();
    await server.stop();

    const result = await runBinary([
      'cli',
      '--api-url',
      server.baseUrl,
      'list',
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`GET ${server.baseUrl}/api/emails failed`);
  });
});
