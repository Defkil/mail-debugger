import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import {
  closeImapClients,
  imapClient,
  imapPort,
  ImapTranscript,
} from '../helpers/imap.js';
import { sendMail } from '../helpers/mail.js';
import {
  makeTempDir,
  removeTempDirs,
  startServerProcess,
  stopAllServers,
} from '../helpers/server.js';

afterEach(() => {
  closeImapClients();
});

afterAll(async () => {
  await stopAllServers();
  removeTempDirs();
});

/** Waits for the next second: UIDVALIDITY counts seconds. */
async function nextSecond(): Promise<void> {
  const start = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === start) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('IMAP persistence', () => {
  it('keeps UIDVALIDITY, UIDNEXT, flags and the subscription across a restart', async () => {
    const dataDir = makeTempDir();
    const first = await startServerProcess({
      args: ['--imap', '--data-dir', dataDir],
    });
    await sendMail({ port: first.smtpPort }, { subject: 'flagged' });
    await sendMail({ port: first.smtpPort }, { subject: 'expunged' });
    const before = imapClient(imapPort(first));
    await before.connect();
    const opened = await before.mailboxOpen('INBOX');
    const [flagged, expunged] = (await before.search(
      { all: true },
      { uid: true },
    )) as number[];
    await before.messageFlagsAdd(
      String(flagged),
      [String.raw`\Flagged`, 'Work'],
      { uid: true },
    );
    await before.messageDelete(String(expunged), { uid: true });
    await before.mailboxUnsubscribe('INBOX');
    await before.logout();
    expect(await first.stop()).toBe(0);

    const second = await startServerProcess({
      args: ['--imap', '--data-dir', dataDir],
    });
    const after = imapClient(imapPort(second));
    await after.connect();
    const reopened = await after.mailboxOpen('INBOX');
    expect(reopened.uidValidity).toBe(opened.uidValidity);
    expect(reopened.uidNext).toBe(expunged + 1);
    const message = await after.fetchOne(
      String(flagged),
      { flags: true, uid: true },
      { uid: true },
    );
    // \Recent is no stored flag: a restarted server shows it to the first session.
    const stored = [...(message ? (message.flags ?? []) : [])].filter(
      (flag) => flag !== String.raw`\Recent`,
    );
    expect(new Set(stored)).toEqual(new Set([String.raw`\Flagged`, 'Work']));
    const transcript = await ImapTranscript.loggedIn(imapPort(second));
    expect(await transcript.command('A', 'LSUB "" "*"')).not.toContain(
      '* LSUB',
    );

    await sendMail({ port: second.smtpPort }, { subject: 'after restart' });
    const uids = (await after.search({ all: true }, { uid: true })) as number[];
    expect(uids).toEqual([flagged, expunged + 1]);
    await after.logout();
    await second.stop();
  }, 60_000);

  it('gives a new in-memory mailbox a new UIDVALIDITY', async () => {
    const first = await startServerProcess({ args: ['--imap'] });
    const one = imapClient(imapPort(first));
    await one.connect();
    const { uidValidity: firstValidity } = await one.mailboxOpen('INBOX');
    await one.logout();
    await first.stop();

    await nextSecond();
    const second = await startServerProcess({ args: ['--imap'] });
    const two = imapClient(imapPort(second));
    await two.connect();
    const { uidValidity: secondValidity } = await two.mailboxOpen('INBOX');
    expect(secondValidity).toBeGreaterThan(firstValidity);
    await two.logout();
    await second.stop();
  }, 60_000);

  it('serves mail migrated from mail-debugger 0.3', async () => {
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

    const server = await startServerProcess({
      args: ['--imap', '--data-dir', dataDir],
    });
    const client = imapClient(imapPort(server));
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX');
    expect(mailbox.exists).toBe(1);
    const message = await client.fetchOne('1', {
      uid: true,
      source: true,
      internalDate: true,
    });
    expect(message && message.source?.toString('utf8')).toBe(
      'Subject: from 0.3\r\n\r\nbody',
    );
    expect(message && new Date(message.internalDate ?? 0).toISOString()).toBe(
      '2026-04-01T08:15:00.000Z',
    );
    await client.logout();
    await server.stop();
  }, 60_000);
});
