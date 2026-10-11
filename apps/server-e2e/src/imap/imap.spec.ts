import { createApiClient } from '@mail-debugger/client';
import {
  ATTACHMENT_BYTES,
  closeImapClients,
  imapClient,
  imapPort,
  ImapTranscript,
  multipartFixture,
  readAll,
  sha256,
} from '../helpers/imap.js';
import { api, sendMail } from '../helpers/mail.js';
import {
  BINARIES,
  eventually,
  runBinary,
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

afterEach(() => {
  closeImapClients();
});

afterAll(async () => {
  await stopAllServers();
});

function capabilities(response: string): string[] {
  const line = /^\* CAPABILITY (.*)\r$/m.exec(response);
  if (!line) throw new Error(`No CAPABILITY response in:\n${response}`);
  return line[1].split(' ');
}

describe('IMAP inbox', () => {
  let server: ServerProcess;
  let port: number;

  beforeAll(async () => {
    server = await startServerProcess({ args: ['--imap'] });
    port = imapPort(server);
  }, 30_000);

  beforeEach(async () => {
    await api(server.baseUrl, '/api/emails', { method: 'DELETE' });
  });

  const send = (subject: string, from = 'sender@example.test') =>
    sendMail({ port: server.smtpPort }, { subject, from });

  it('reports the IMAP port and advertises the restricted profile', async () => {
    expect((await api(server.baseUrl, '/api/health')).body).toMatchObject({
      imapPort: port,
    });
    const { transcript, greeting } = await ImapTranscript.open(port);
    expect(greeting).toMatch(/^\* OK /);
    expect(capabilities(await transcript.command('A', 'CAPABILITY'))).toEqual([
      'IMAP4rev1',
      'ID',
      'IDLE',
      'NAMESPACE',
      'UNSELECT',
      'UIDPLUS',
      'LITERAL-',
      'AUTH=PLAIN',
      'SASL-IR',
    ]);
    await transcript.command('L', 'LOGIN mail-debugger mail-debugger');
    expect(capabilities(await transcript.command('B', 'CAPABILITY'))).toEqual([
      'IMAP4rev1',
      'ID',
      'IDLE',
      'NAMESPACE',
      'UNSELECT',
      'UIDPLUS',
      'LITERAL-',
    ]);

    const list = await transcript.command('C', 'LIST "" "*"');
    expect(list.match(/^\* LIST .*$/gm)).toEqual([
      String.raw`* LIST (\Noinferiors) "/" "INBOX"`,
    ]);
    expect(await transcript.command('D', 'LIST "" "%"')).toContain('INBOX');
    expect(await transcript.command('E', 'NAMESPACE')).toContain(
      '* NAMESPACE (("" "/")) NIL NIL',
    );
    expect(await transcript.command('F', 'ID NIL')).toMatch(
      /\* ID \("name" "mail-debugger" "version" "\d+\.\d+\.\d+[^"]*"\)/,
    );
    expect(
      await transcript.command('G', 'STATUS INBOX (MESSAGES UNSEEN UIDNEXT)'),
    ).toMatch(/\* STATUS "?INBOX"? \(MESSAGES 0 UNSEEN 0 UIDNEXT \d+\)/);
    expect(await transcript.command('H', 'SELECT Archive')).toMatch(
      /^H NO \[NONEXISTENT\]/m,
    );
    expect(await transcript.command('I', 'SELECT inbox')).toMatch(
      /^I OK \[READ-WRITE\]/m,
    );
  });

  it('serves a multipart message exactly as SMTP received it', async () => {
    const raw = multipartFixture();
    await sendMail(
      { port: server.smtpPort },
      {
        raw,
        from: 'sender@example.test',
        to: ['recipient@example.test', 'hidden@example.test'],
      },
    );
    const { body } = await api(server.baseUrl, '/api/emails');
    const id = body.data[0].id as number;
    const restRaw = Buffer.from(
      await (
        await fetch(`${server.baseUrl}/api/emails/${id}/raw`)
      ).arrayBuffer(),
    );
    expect(restRaw.equals(raw)).toBe(true);
    const restAttachment = Buffer.from(
      await (
        await fetch(`${server.baseUrl}/api/emails/${id}/attachments/0`)
      ).arrayBuffer(),
    );

    const client = imapClient(port);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const message = await client.fetchOne('*', {
      uid: true,
      source: true,
      size: true,
      envelope: true,
      bodyStructure: true,
      flags: true,
    });
    if (!message) throw new Error('No message');
    expect(message.source?.equals(raw)).toBe(true);
    expect(message.size).toBe(raw.length);
    expect(message.envelope).toMatchObject({
      subject: 'Grüße aus dem Test',
      messageId: '<multipart-fixture@example.test>',
      from: [{ name: 'Jürgen Sender', address: 'sender@example.test' }],
      to: [
        { name: 'Recipient', address: 'recipient@example.test' },
        { address: 'other@example.test' },
      ],
      cc: [{ address: 'copy@example.test' }],
    });
    expect(message.bodyStructure).toMatchObject({
      type: 'multipart/mixed',
      childNodes: [
        {
          part: '1',
          type: 'text/plain',
          parameters: { charset: expect.stringMatching(/^utf-8$/i) },
          encoding: 'quoted-printable',
        },
        {
          part: '2',
          type: 'application/octet-stream',
          encoding: 'base64',
          disposition: 'attachment',
          dispositionParameters: { filename: 'bytes.bin' },
        },
      ],
    });
    // BODY.PEEK[] (ImapFlow's source) leaves the message unseen.
    expect(message.flags?.has(String.raw`\Seen`)).toBe(false);

    const text = await client.download('*', '1');
    expect((await readAll(text.content)).toString('utf8')).toBe(
      'Grüße — the body.',
    );
    const attachment = await readAll((await client.download('*', '2')).content);
    expect(attachment.equals(ATTACHMENT_BYTES)).toBe(true);
    expect(sha256(attachment)).toBe(sha256(restAttachment));
  });

  it(
    String.raw`sets \Seen for BODY[] in SELECT but not for PEEK or EXAMINE`,
    async () => {
      await send('seen test');
      const transcript = await ImapTranscript.loggedIn(port);
      await transcript.command('A', 'EXAMINE INBOX');
      expect(
        await transcript.command('B', 'FETCH 1 (BODY[] FLAGS)'),
      ).not.toContain(String.raw`\Seen`);
      await transcript.command('C', 'SELECT INBOX');
      expect(
        await transcript.command('D', 'FETCH 1 (BODY.PEEK[HEADER] FLAGS)'),
      ).not.toContain(String.raw`\Seen`);
      expect(await transcript.command('E', 'FETCH 1 BODY[TEXT]')).toContain(
        String.raw`\Seen`,
      );
      expect(await transcript.command('F', 'SEARCH UNSEEN')).toContain(
        '* SEARCH\r\n',
      );
    },
  );

  it('searches and fetches by UID with a stable UIDVALIDITY', async () => {
    await send('alpha', 'one@example.test');
    await send('beta', 'two@example.test');
    await send('gamma', 'three@example.test');
    const client = imapClient(port);
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX');
    const uids = (await client.search(
      { all: true },
      { uid: true },
    )) as number[];
    expect(uids).toHaveLength(3);
    expect(mailbox.uidNext).toBe(uids[2] + 1);

    expect(await client.search({ subject: 'BETA' }, { uid: true })).toEqual([
      uids[1],
    ]);
    expect(await client.search({ from: 'three@' }, { uid: true })).toEqual([
      uids[2],
    ]);
    expect(
      await client.search({ or: [{ subject: 'alpha' }, { subject: 'gamma' }] }),
    ).toEqual([1, 3]);
    const fetched = await client.fetchAll(
      `${uids[1]}:*`,
      { uid: true, envelope: true },
      { uid: true },
    );
    expect(fetched.map((message) => message.envelope?.subject)).toEqual([
      'beta',
      'gamma',
    ]);

    const transcript = await ImapTranscript.loggedIn(port);
    expect(await transcript.command('S', 'EXAMINE INBOX')).toContain(
      `[UIDVALIDITY ${mailbox.uidValidity}]`,
    );
    expect(await transcript.command('T', 'UID FETCH * UID')).toContain(
      `* 3 FETCH (UID ${uids[2]})`,
    );
    expect(
      await transcript.command('U', `UID SEARCH UID ${uids[0]}:${uids[1]}`),
    ).toContain(`* SEARCH ${uids[0]} ${uids[1]}\r\n`);
  });

  it('notifies other sessions of flags and expunges while UIDs stay stable', async () => {
    await send('first');
    await send('second');
    await send('third');
    const writer = imapClient(port);
    await writer.connect();
    await writer.mailboxOpen('INBOX');
    const watcher = imapClient(port);
    await watcher.connect();
    await watcher.mailboxOpen('INBOX');
    const uids = (await watcher.search(
      { all: true },
      { uid: true },
    )) as number[];

    const flags = new Promise<{ uid: number; flags: Set<string> }>((resolve) =>
      watcher.once('flags', resolve),
    );
    // ImapFlow stores with +FLAGS.SILENT; the other session is told anyway.
    await writer.messageFlagsAdd(String(uids[0]), [String.raw`\Flagged`], {
      uid: true,
    });
    await watcher.noop();
    expect(await flags).toMatchObject({ uid: uids[0] });

    const expunge = new Promise<{ seq: number }>((resolve) =>
      watcher.once('expunge', resolve),
    );
    await writer.messageDelete(String(uids[1]), { uid: true });
    await watcher.noop();
    expect((await expunge).seq).toBe(2);
    const second = await watcher.fetchOne('2', { uid: true, envelope: true });
    expect(second && second.uid).toBe(uids[2]);
    expect(second && second.envelope?.subject).toBe('third');
    expect(
      (await api(server.baseUrl, '/api/emails')).body.data.map(
        (email: { subject: string }) => email.subject,
      ),
    ).toEqual(['third', 'first']);
  });

  it('reports deletions made over REST to an idling client', async () => {
    await send('kept');
    await send('removed over REST');
    const client = imapClient(port);
    await client.connect();
    await client.mailboxOpen('INBOX');

    const exists = new Promise<{ count: number }>((resolve) =>
      client.once('exists', resolve),
    );
    const idle = client.idle();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await send('new while idling');
    expect((await exists).count).toBe(3);

    const expunge = new Promise<{ seq: number }>((resolve) =>
      client.once('expunge', resolve),
    );
    const { body } = await api(server.baseUrl, '/api/emails', {});
    const removed = body.data.find(
      (email: { subject: string }) => email.subject === 'removed over REST',
    );
    await api(server.baseUrl, `/api/emails/${removed.id}`, {
      method: 'DELETE',
    });
    expect((await expunge).seq).toBe(2);
    await client.noop();
    await idle;
  });

  it('keeps the old sequence numbers in a session until it is told', async () => {
    await send('one');
    await send('two');
    const transcript = await ImapTranscript.loggedIn(port);
    await transcript.command('S', 'SELECT INBOX');
    const { body } = await api(server.baseUrl, '/api/emails');
    const one = body.data.find((e: { subject: string }) => e.subject === 'one');
    await api(server.baseUrl, `/api/emails/${one.id}`, { method: 'DELETE' });

    // RFC 2180: FETCH may still use the old numbers, EXPUNGE waits.
    const subject = 'BODY.PEEK[HEADER.FIELDS (SUBJECT)]';
    const fetch = await transcript.command('F', `FETCH 2 (${subject})`);
    expect(fetch).toContain('Subject: two');
    expect(fetch).not.toMatch(/^\* \d+ EXPUNGE/m);
    expect(fetch).toMatch(/^F OK \[EXPUNGEISSUED\]/m);
    const noop = await transcript.command('N', 'NOOP');
    expect(noop).toContain('* 1 EXPUNGE');
    expect(await transcript.command('G', `FETCH 1 (${subject})`)).toContain(
      'Subject: two',
    );
  });

  it('never reuses UIDs after the inbox is cleared', async () => {
    await send('before clear');
    const client = imapClient(port);
    await client.connect();
    const before = await client.mailboxOpen('INBOX');
    const [oldUid] = (await client.search(
      { all: true },
      { uid: true },
    )) as number[];
    await client.mailboxClose();

    await api(server.baseUrl, '/api/emails', { method: 'DELETE' });
    await send('after clear');
    const after = await client.mailboxOpen('INBOX');
    expect(after.uidValidity).toBe(before.uidValidity);
    const [newUid] = (await client.search(
      { all: true },
      { uid: true },
    )) as number[];
    expect(newUid).toBeGreaterThan(oldUid);
    expect(after.uidNext).toBe(newUid + 1);
  });

  it('serves IMAP from the slim mail-debugger-api distribution', async () => {
    const slim = await startServerProcess({
      args: ['--imap'],
      binary: BINARIES.api,
    });
    try {
      await sendMail({ port: slim.smtpPort }, { raw: multipartFixture() });
      const client = imapClient(imapPort(slim));
      await client.connect();
      await client.mailboxOpen('INBOX');
      const attachment = await readAll(
        (await client.download('1', '2')).content,
      );
      expect(attachment.equals(ATTACHMENT_BYTES)).toBe(true);
      await client.logout();
    } finally {
      await slim.stop();
    }
  }, 30_000);

  it('shows an IMAP deletion on the REST API, the client library and the CLI', async () => {
    await send('survivor');
    await send('expunged over IMAP');
    const client = imapClient(port);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const [uid] = (await client.search(
      { subject: 'expunged over IMAP' },
      { uid: true },
    )) as number[];
    await client.messageDelete(String(uid), { uid: true });

    const library = await createApiClient(server.baseUrl).listEmails();
    expect(library.data.map((email) => email.subject)).toEqual(['survivor']);
    const rest = await api(server.baseUrl, '/api/emails');
    expect(rest.body.total).toBe(1);
    const cli = await runBinary(
      ['cli', '--api-url', server.baseUrl, 'list', '--json'],
      { binary: BINARIES.full },
    );
    expect(cli.code).toBe(0);
    expect(
      (JSON.parse(cli.stdout) as { subject: string }[]).map((e) => e.subject),
    ).toEqual(['survivor']);
    await eventually(async () =>
      expect((await api(server.baseUrl, '/api/health')).body.emailCount).toBe(
        1,
      ),
    );
  });
});
