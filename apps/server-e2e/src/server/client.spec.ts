import {
  createApiClient,
  MailDebuggerApiError,
  MailDebuggerNetworkError,
  type ApiClient,
} from '@mail-debugger/client';
import { sendMail, type TestMail } from '../helpers/mail.js';
import {
  eventually,
  makeTempDir,
  removeTempDirs,
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

/** The server's limit of pending waits (MAX_ACTIVE_WAITS). */
const MAX_ACTIVE_WAITS = 100;

/** The rejection reason of a promise, or 'resolved'. */
async function settled(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error;
  }
}

describe('JavaScript client against the server', () => {
  let server: ServerProcess;
  let client: ApiClient;

  beforeAll(async () => {
    server = await startServerProcess();
    client = createApiClient(server.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await stopAllServers();
    removeTempDirs();
  });

  beforeEach(async () => {
    await client.deleteAllEmails();
  });

  const send = (mail: TestMail = {}) =>
    sendMail({ port: server.smtpPort }, mail);

  async function cursor() {
    const { highWatermark, mailboxId } = await client.listEmails({ limit: 1 });
    if (highWatermark === undefined || mailboxId === undefined) {
      throw new Error('The server sent no cursor');
    }
    return { highWatermark, mailboxId };
  }

  it('supports the existing five operations', async () => {
    await send({ subject: 'Client test' });

    await expect(client.health()).resolves.toMatchObject({
      status: 'ok',
      emailCount: 1,
      smtpPort: server.smtpPort,
    });
    const page = await client.listEmails({ subject: 'CLIENT' }, 10, 0);
    expect(page.total).toBe(1);
    const email = await client.getEmail(page.data[0].id);
    expect(email).toMatchObject({ subject: 'Client test' });
    await expect(client.deleteEmail(email.id)).resolves.toBe(true);
    await expect(client.getEmail(email.id)).rejects.toMatchObject({
      name: 'MailDebuggerApiError',
      status: 404,
      code: 'EMAIL_NOT_FOUND',
      method: 'GET',
      url: `${server.baseUrl}/api/emails/${email.id}`,
    });
    await send();
    await send();
    await expect(client.deleteAllEmails()).resolves.toBe(2);
  });

  it('downloads the exact source and attachment bytes', async () => {
    const raw = Buffer.concat([
      Buffer.from(
        [
          'From: e2e-sender@example.com',
          'To: e2e-recipient@example.com',
          'Subject: Bytes',
          'MIME-Version: 1.0',
          'Content-Type: multipart/mixed; boundary="b"',
          '',
          '--b',
          'Content-Type: text/plain; charset=iso-8859-1',
          'Content-Transfer-Encoding: 8bit',
          '',
          '.leading dot and latin-1: ',
        ].join('\r\n'),
      ),
      Buffer.from([0xe9, 0xff]),
      Buffer.from(
        [
          '',
          '--b',
          'Content-Type: application/octet-stream',
          'Content-Disposition: attachment; filename="data.bin"',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from([0x00, 0x01, 0x02, 0xff]).toString('base64'),
          '--b--',
          '',
        ].join('\r\n'),
      ),
    ]);
    await send({ raw });
    const [summary] = (await client.listEmails()).data;

    expect(Buffer.from(await client.getRawEmail(summary.id))).toEqual(raw);
    await expect(client.getAttachment(summary.id, 0)).resolves.toEqual({
      bytes: new Uint8Array([0x00, 0x01, 0x02, 0xff]),
      filename: 'data.bin',
      contentType: 'application/octet-stream',
    });
    await expect(client.getAttachment(summary.id, 1)).rejects.toMatchObject({
      status: 404,
      code: 'ATTACHMENT_NOT_FOUND',
    });
  });

  it('waits for a matching email that arrives later', async () => {
    const { highWatermark, mailboxId } = await cursor();
    const pending = client.waitForEmail({
      afterId: highWatermark,
      mailboxId,
      filter: { to: 'late@example.com' },
      timeoutMs: 10_000,
    });
    await send({ to: 'other@example.com' });
    await send({ to: 'late@example.com', subject: 'Late' });

    const result = await pending;
    expect(result).toMatchObject({
      timedOut: false,
      mailboxId,
      data: { id: highWatermark + 2, subject: 'Late' },
    });
  });

  it('times out with the cursor', async () => {
    const { highWatermark, mailboxId } = await cursor();
    await expect(
      client.waitForEmail({ afterId: highWatermark, timeoutMs: 200 }),
    ).resolves.toEqual({
      data: null,
      timedOut: true,
      highWatermark,
      mailboxId,
    });
  });

  it('keeps the cursor across a clear', async () => {
    await send();
    const { highWatermark, mailboxId } = await cursor();
    await client.deleteAllEmails();
    await expect(cursor()).resolves.toEqual({ highWatermark, mailboxId });

    const pending = client.waitForEmail({
      afterId: highWatermark,
      mailboxId,
      timeoutMs: 10_000,
    });
    await send({ subject: 'After clear' });
    await expect(pending).resolves.toMatchObject({
      data: { id: highWatermark + 1, subject: 'After clear' },
    });
  });

  it('rejects a cursor beyond the high watermark', async () => {
    const { highWatermark } = await cursor();
    await expect(
      client.waitForEmail({ afterId: highWatermark + 1, timeoutMs: 0 }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
  });

  it('frees wait slots when clients abort', async () => {
    const { highWatermark } = await cursor();
    const controller = new AbortController();
    const waits = Array.from({ length: MAX_ACTIVE_WAITS }, () =>
      settled(
        client.waitForEmail(
          { afterId: highWatermark, timeoutMs: 30_000 },
          { signal: controller.signal },
        ),
      ),
    );

    await eventually(async () => {
      await expect(
        client.waitForEmail({ afterId: highWatermark, timeoutMs: 1 }),
      ).rejects.toMatchObject({ status: 429, code: 'LIMIT_EXCEEDED' });
    }, 10_000);

    controller.abort();
    const outcomes = await Promise.all(waits);
    expect(new Set(outcomes.map((outcome) => (outcome as Error).name))).toEqual(
      new Set(['AbortError']),
    );
    await eventually(async () => {
      await expect(
        client.waitForEmail({ afterId: highWatermark, timeoutMs: 1 }),
      ).resolves.toMatchObject({ timedOut: true });
    });
  });
});

describe('JavaScript client lifecycle errors', () => {
  afterAll(async () => {
    await stopAllServers();
    removeTempDirs();
  });

  it('keeps the mailbox identity of a data directory across restarts', async () => {
    const dataDir = makeTempDir();
    const first = await startServerProcess({ args: ['--data-dir', dataDir] });
    await sendMail({ port: first.smtpPort });
    const before = await createApiClient(first.baseUrl).listEmails();
    expect(await first.stop()).toBe(0);

    const second = await startServerProcess({ args: ['--data-dir', dataDir] });
    const client = createApiClient(second.baseUrl);
    const after = await client.listEmails();
    expect(after).toMatchObject({
      highWatermark: before.highWatermark,
      mailboxId: before.mailboxId,
    });
    await expect(
      client.waitForEmail({
        afterId: before.highWatermark ?? -1,
        mailboxId: before.mailboxId,
        timeoutMs: 0,
      }),
    ).resolves.toMatchObject({ timedOut: true });

    // A fresh in-memory server is another mailbox.
    const fresh = await startServerProcess();
    await expect(
      createApiClient(fresh.baseUrl).waitForEmail({
        afterId: 0,
        mailboxId: before.mailboxId,
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
  });

  it('ends a pending wait with 503 when the server shuts down', async () => {
    // Debug logging shows when the request has reached the server.
    const server = await startServerProcess({ env: { LOG_LEVEL: 'debug' } });
    const client = createApiClient(server.baseUrl);
    const pending = settled(
      client.waitForEmail({ afterId: 0, timeoutMs: 30_000 }),
    );
    await eventually(() => {
      expect(server.output()).toContain('/api/emails/wait');
    });

    expect(await server.stop()).toBe(0);
    const error = await pending;
    expect(error).toBeInstanceOf(MailDebuggerApiError);
    expect(error).toMatchObject({ status: 503, code: 'SHUTTING_DOWN' });
  });

  it('reports a refused connection as a network error', async () => {
    const server = await startServerProcess();
    const client = createApiClient(server.baseUrl);
    await server.stop();

    await expect(client.health()).rejects.toBeInstanceOf(
      MailDebuggerNetworkError,
    );
  });
});
