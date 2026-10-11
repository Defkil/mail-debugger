import {
  closeTestImaps,
  imapClient as client,
  loggedInImap as loggedIn,
  NO_FLAGS,
  startTestImap as startImap,
} from '../testing/imap.js';
import {
  attachmentMessage,
  createTestService,
  rawMessage,
} from '../testing/mail-fixtures.js';

afterEach(async () => {
  await closeTestImaps();
});

async function readAll(stream: AsyncIterable<unknown> | undefined) {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('IMAP server', () => {
  it('serves stored mail with the stored UIDs, UIDVALIDITY and exact octets', async () => {
    const imap = await startImap();
    const raw = attachmentMessage({
      filename: 'bytes.bin',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0, 1, 2, 255]),
    });
    const received = await imap.service.receive(raw, null);

    const reader = client(imap.port);
    await reader.connect();
    const mailbox = await reader.mailboxOpen('INBOX');
    const state = imap.service.imapState();
    expect(mailbox.uidValidity).toBe(BigInt(state.uidValidity));
    expect(mailbox.uidNext).toBe(state.uidNext);
    expect(mailbox.exists).toBe(1);

    const message = await reader.fetchOne(
      String(received.uid),
      { source: true, size: true, uid: true, bodyStructure: true },
      { uid: true },
    );
    if (!message) throw new Error('The message was not found');
    expect(message.source?.equals(raw)).toBe(true);
    expect(message).toMatchObject({ size: raw.length, uid: received.uid });
    const download = await reader.download(String(received.uid), '2', {
      uid: true,
    });
    expect(await readAll(download.content)).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
  });

  it('announces new mail to an idling client', async () => {
    const imap = await startImap();
    const reader = client(imap.port);
    await reader.connect();
    await reader.mailboxOpen('INBOX');
    const exists = new Promise<{ count: number }>((resolve) =>
      reader.once('exists', resolve),
    );
    const idle = reader.idle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const received = await imap.service.receive(rawMessage(), null);
    expect((await exists).count).toBe(1);
    await reader.noop();
    await idle;
    expect(await reader.search({ all: true }, { uid: true })).toEqual([
      received.uid,
    ]);
  });
});

describe('IMAP persistence', () => {
  it(
    String.raw`stores flags from STORE and from FETCH that sets \Seen`,
    async () => {
      const imap = await startImap();
      const first = await imap.service.receive(
        rawMessage({ subject: 'one' }),
        null,
      );
      const second = await imap.service.receive(
        rawMessage({ subject: 'two' }),
        null,
      );
      const reader = client(imap.port);
      await reader.connect();
      await reader.mailboxOpen('INBOX');

      await reader.messageFlagsAdd(
        String(first.uid),
        [String.raw`\Flagged`, 'Work'],
        {
          uid: true,
        },
      );
      expect(imap.service.getFlags(first.id)).toEqual([
        String.raw`\Flagged`,
        'Work',
      ]);

      await reader.fetchOne(
        String(second.uid),
        { source: true },
        { uid: true },
      );
      expect(imap.service.getFlags(second.id)).toEqual([]);
      const raw = await loggedIn(imap.port);
      await raw.command('S', 'SELECT INBOX');
      await raw.command('F', `UID FETCH ${second.uid} BODY[]`);
      expect(imap.service.getFlags(second.id)).toEqual([String.raw`\Seen`]);

      await reader.messageFlagsRemove(String(first.uid), ['Work'], {
        uid: true,
      });
      expect(imap.service.getFlags(first.id)).toEqual([String.raw`\Flagged`]);
    },
  );

  it(
    String.raw`never sets \Seen in a mailbox opened with EXAMINE`,
    async () => {
      const imap = await startImap();
      const received = await imap.service.receive(rawMessage(), null);
      const raw = await loggedIn(imap.port);
      expect(await raw.command('E', 'EXAMINE INBOX')).toContain(
        'E OK [READ-ONLY]',
      );
      const fetched = await raw.command('F', 'FETCH 1 (BODY[] FLAGS)');
      expect(fetched).toMatch(NO_FLAGS);
      expect(imap.service.getFlags(received.id)).toEqual([]);
      expect(
        await raw.command('X', String.raw`STORE 1 +FLAGS (\Seen)`),
      ).toMatch(/X NO \[CLIENTBUG\]/);
      expect(await raw.command('Y', 'EXPUNGE')).toMatch(/Y NO \[CLIENTBUG\]/);
    },
  );

  it('loads stored flags and UIDs into a new IMAP server', async () => {
    const shared = await createTestService();
    const received = await shared.service.receive(rawMessage(), null);
    shared.service.setFlags(
      [{ id: received.id, flags: [String.raw`\Answered`, 'Done'] }],
      'internal',
    );
    const imap = await startImap({ service: shared });
    const raw = await loggedIn(imap.port);
    const selected = await raw.command('S', 'SELECT INBOX');
    expect(selected).toContain('Done');
    const fetched = await raw.command('F', 'FETCH 1 (UID FLAGS)');
    expect(fetched).toContain(`UID ${received.uid}`);
    expect(fetched).toContain(String.raw`FLAGS (\Answered Done \Recent)`);
  });

  it('deletes expunged messages and reports deletions of other surfaces', async () => {
    const imap = await startImap();
    const kept = await imap.service.receive(
      rawMessage({ subject: 'kept' }),
      null,
    );
    const expunged = await imap.service.receive(
      rawMessage({ subject: 'gone' }),
      null,
    );
    const elsewhere = await imap.service.receive(
      rawMessage({ subject: 'rest' }),
      null,
    );

    const reader = client(imap.port);
    await reader.connect();
    await reader.mailboxOpen('INBOX');
    const watcher = client(imap.port);
    await watcher.connect();
    await watcher.mailboxOpen('INBOX');

    await reader.messageDelete(String(expunged.uid), { uid: true });
    expect(imap.service.get(expunged.id)).toBeUndefined();

    const expunge = new Promise<{ seq: number }>((resolve) =>
      reader.once('expunge', resolve),
    );
    imap.service.delete(elsewhere.id, 'rest');
    await reader.noop();
    expect((await expunge).seq).toBe(2);
    expect(await reader.search({ all: true }, { uid: true })).toEqual([
      kept.uid,
    ]);
    expect(await watcher.search({ all: true }, { uid: true })).toEqual([
      kept.uid,
    ]);
  });

  it('answers NO and changes nothing when the flags cannot be stored', async () => {
    const imap = await startImap();
    const received = await imap.service.receive(rawMessage(), null);
    const raw = await loggedIn(imap.port);
    await raw.command('S', 'SELECT INBOX');
    const other = await loggedIn(imap.port);
    await other.command('S', 'SELECT INBOX');

    const setFlags = vi
      .spyOn(imap.service, 'setFlags')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    const store = await raw.command('A', String.raw`STORE 1 +FLAGS (\Flagged)`);
    expect(store).toMatch(/^A NO \[SERVERBUG\]/m);
    expect(store).not.toContain('FETCH');
    const fetch = await raw.command('B', 'FETCH 1 (BODY[])');
    expect(fetch).toMatch(/^B NO \[SERVERBUG\]/m);
    expect(fetch).not.toContain('BODY[]');
    setFlags.mockRestore();

    expect(imap.service.getFlags(received.id)).toEqual([]);
    expect(await raw.command('C', 'FETCH 1 FLAGS')).toMatch(NO_FLAGS);
    const noop = await other.command('N', 'NOOP');
    expect(noop).not.toContain('FETCH');
    expect(noop).toContain('N OK');
  });

  it('keeps the messages for every session when an expunge cannot be stored', async () => {
    const imap = await startImap();
    const received = await imap.service.receive(rawMessage(), null);
    const raw = await loggedIn(imap.port);
    await raw.command('S', 'SELECT INBOX');
    const other = await loggedIn(imap.port);
    await other.command('S', 'SELECT INBOX');
    await raw.command('A', String.raw`STORE 1 +FLAGS.SILENT (\Deleted)`);

    const deleteMany = vi
      .spyOn(imap.service, 'deleteMany')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    const expunge = await raw.command('B', `UID EXPUNGE ${received.uid}`);
    expect(expunge).toMatch(/^B NO \[SERVERBUG\]/m);
    expect(expunge).not.toContain('EXPUNGE\r\n');
    expect(await raw.command('C', 'CLOSE')).toMatch(/^C NO \[SERVERBUG\]/m);
    deleteMany.mockRestore();

    expect(imap.service.get(received.id)).toBeDefined();
    expect(await raw.command('D', 'SEARCH ALL')).toContain('* SEARCH 1');
    expect(await other.command('N', 'NOOP')).not.toContain('EXPUNGE');
    expect(await other.command('E', 'SEARCH ALL')).toContain('* SEARCH 1');

    expect(await raw.command('F', 'EXPUNGE')).toContain('* 1 EXPUNGE');
    expect(imap.service.get(received.id)).toBeUndefined();
  });

  it('refuses more flags than a message can keep', async () => {
    const imap = await startImap();
    await imap.service.receive(rawMessage(), null);
    const raw = await loggedIn(imap.port);
    await raw.command('S', 'SELECT INBOX');
    const many = Array.from({ length: 33 }, (_, i) => `k${i}`).join(' ');
    expect(await raw.command('A', `STORE 1 +FLAGS (${many})`)).toMatch(
      /^A NO \[LIMIT\]/m,
    );
    expect(
      await raw.command('B', `STORE 1 +FLAGS (${'x'.repeat(65)})`),
    ).toMatch(/^B NO \[LIMIT\]/m);
    expect(await raw.command('C', 'FETCH 1 FLAGS')).toMatch(NO_FLAGS);
  });

  it('limits the keywords a mailbox keeps', async () => {
    const imap = await startImap();
    await imap.service.receive(rawMessage(), null);
    const raw = await loggedIn(imap.port);
    await raw.command('S', 'SELECT INBOX');
    // Keywords stay known after a message loses them (RFC 3501 7.2.6).
    for (let batch = 0; batch < 8; batch++) {
      const keywords = Array.from(
        { length: 32 },
        (_, i) => `k${batch * 32 + i}`,
      ).join(' ');
      expect(
        await raw.command(`A${batch}`, `STORE 1 FLAGS (${keywords})`),
      ).toMatch(new RegExp(`^A${batch} OK`, 'm'));
    }
    expect(await raw.command('B', 'STORE 1 FLAGS (k0 k255)')).toMatch(/^B OK/m);
    expect(await raw.command('C', 'STORE 1 +FLAGS (k256)')).toMatch(
      /^C NO \[LIMIT\]/m,
    );
  });

  it('stores the INBOX subscription', async () => {
    const imap = await startImap();
    const raw = await loggedIn(imap.port);
    expect(await raw.command('A', 'LSUB "" "*"')).toContain(
      String.raw`* LSUB (\Noinferiors) "/" "INBOX"`,
    );
    expect(await raw.command('B', 'UNSUBSCRIBE INBOX')).toContain('B OK');
    expect(imap.service.imapState().subscribed).toBe(false);
    expect(await raw.command('C', 'LSUB "" "*"')).not.toContain('* LSUB');
    expect(await raw.command('D', 'SUBSCRIBE Archive')).toMatch(
      /D NO \[NONEXISTENT\]/,
    );
    expect(await raw.command('E', 'SUBSCRIBE inbox')).toContain('E OK');
    expect(imap.service.imapState().subscribed).toBe(true);
  });
});
