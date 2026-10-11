import { closeImapClients, imapPort, ImapTranscript } from '../helpers/imap.js';
import { api, sendMail } from '../helpers/mail.js';
import {
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

describe('IMAP protocol transcripts', () => {
  let server: ServerProcess;
  let port: number;

  beforeAll(async () => {
    server = await startServerProcess({ args: ['--imap'] });
    port = imapPort(server);
  }, 30_000);

  beforeEach(async () => {
    await api(server.baseUrl, '/api/emails', { method: 'DELETE' });
  });

  it('refuses mailbox management and new messages with truthful codes', async () => {
    await sendMail({ port: server.smtpPort }, { subject: 'copy me' });
    const t = await ImapTranscript.loggedIn(port);
    await t.command('S', 'SELECT INBOX');
    const expectations: [string, RegExp][] = [
      ['CREATE Archive', /NO \[CANNOT\]/],
      ['CREATE INBOX', /NO \[ALREADYEXISTS\]/],
      ['DELETE INBOX', /NO \[CANNOT\]/],
      ['DELETE Archive', /NO \[NONEXISTENT\]/],
      ['RENAME INBOX Old', /NO \[CANNOT\]/],
      ['RENAME Archive Old', /NO \[NONEXISTENT\]/],
      ['SUBSCRIBE Archive', /NO \[NONEXISTENT\]/],
      ['STATUS Archive (MESSAGES)', /NO \[NONEXISTENT\]/],
      ['COPY 1 INBOX', /NO \[NOPERM\]/],
      ['UID COPY 1:* Archive', /NO \[TRYCREATE\]/],
      ['MOVE 1 Archive', /BAD/],
      ['GETQUOTAROOT INBOX', /BAD/],
      // A failed EXAMINE also closes the selected mailbox (RFC 3501 6.3.1).
      ['EXAMINE Archive', /NO \[NONEXISTENT\]/],
      ['FETCH 1 FLAGS', /BAD/],
    ];
    for (const [index, [command, expected]] of expectations.entries()) {
      const tag = `T${index}`;
      const response = await t.command(tag, command);
      expect(response, command).toMatch(
        new RegExp(`^${tag} ${expected.source}`, 'm'),
      );
    }
    // Nothing exists besides INBOX, which still holds its message.
    expect(
      (await t.command('L', 'LIST "" "*"')).match(/\* LIST/g),
    ).toHaveLength(1);
    await t.command('S2', 'SELECT INBOX');
    expect(await t.command('M', 'SEARCH ALL')).toContain('* SEARCH 1\r\n');
  });

  it('refuses APPEND literals before the client sends them', async () => {
    const t = await ImapTranscript.loggedIn(port);
    t.write('A APPEND INBOX {10}\r\n');
    const refused = await t.tagged('A');
    expect(refused).toMatch(/^A NO \[NOPERM\]/m);
    expect(refused).not.toContain('+ ');
    t.write('B APPEND Archive (\\Seen) {10}\r\n');
    const missing = await t.tagged('B');
    expect(missing).toMatch(/^B NO \[TRYCREATE\]/m);
    expect(missing).not.toContain('+ ');

    // A non-synchronising literal (LITERAL-) is read, then refused.
    t.write('C APPEND INBOX {5+}\r\nhello\r\n');
    expect(await t.tagged('C')).toMatch(/^C NO \[NOPERM\]/m);
    // Above 4096 octets LITERAL- answers TOOBIG and drops the data.
    t.write(`D APPEND INBOX {5000+}\r\n${'x'.repeat(5000)}\r\n`);
    expect(await t.tagged('D')).toMatch(/^D BAD \[TOOBIG\]/m);
    expect(await t.command('E', 'NOOP')).toMatch(/^E OK/m);
    expect((await api(server.baseUrl, '/api/health')).body.emailCount).toBe(0);
  });

  it('handles fragments, quoting and line endings', async () => {
    await sendMail({ port: server.smtpPort }, { subject: 'say "hi" back' });
    const { transcript: t } = await ImapTranscript.open(port);
    t.write('A LOGIN "mail-debugger" ');
    await new Promise((resolve) => setTimeout(resolve, 50));
    t.write('"mail-debugger"\r');
    await new Promise((resolve) => setTimeout(resolve, 50));
    t.write('\n');
    expect(await t.tagged('A')).toMatch(/^A OK/m);
    await t.command('S', 'SELECT INBOX');
    expect(
      await t.command('B', String.raw`SEARCH SUBJECT "say \"hi\""`),
    ).toContain('* SEARCH 1\r\n');
    t.write('C NOOP\n');
    expect(await t.readUntil((text) => text.includes('\r\n'))).toMatch(
      /^C BAD/m,
    );
    expect(await t.command('D', 'FETCH 1 (FLAGS')).toMatch(/^D BAD/m);
    expect(await t.command('E', 'FROBNICATE')).toMatch(/^E BAD/m);
    expect(await t.command('F', 'LOGIN again please')).toMatch(/^F BAD/m);
  });

  it('answers sequence sets, UID ranges and an empty INBOX', async () => {
    const t = await ImapTranscript.loggedIn(port);
    const empty = await t.command('A', 'SELECT INBOX');
    expect(empty).toContain('* 0 EXISTS');
    expect(await t.command('B', 'FETCH 1 FLAGS')).toMatch(/^B BAD/m);
    expect(await t.command('C', 'FETCH * FLAGS')).toMatch(/^C BAD/m);
    const noUids = await t.command('D', 'UID FETCH 1:* FLAGS');
    expect(noUids).toMatch(/^D OK/m);
    expect(noUids).not.toContain('FETCH (');
    expect(await t.command('E', 'SEARCH ALL')).toContain('* SEARCH\r\n');

    await sendMail({ port: server.smtpPort }, { subject: 'first' });
    await sendMail({ port: server.smtpPort }, { subject: 'second' });
    await t.command('N', 'NOOP');
    const uids = /\* SEARCH (\d+) (\d+)/.exec(
      await t.command('F', 'UID SEARCH ALL'),
    );
    expect(uids).not.toBeNull();
    const [, first, second] = uids ?? [];
    expect(await t.command('G', 'FETCH * (UID)')).toContain(
      `* 2 FETCH (UID ${second})`,
    );
    expect(await t.command('H', 'UID FETCH *:* (UID)')).toContain(
      `* 2 FETCH (UID ${second})`,
    );
    expect(await t.command('I', `UID SEARCH UID ${first}:*`)).toContain(
      `* SEARCH ${first} ${second}\r\n`,
    );
    const unknown = await t.command('J', 'UID FETCH 4000000000 (UID)');
    expect(unknown).toMatch(/^J OK/m);
    expect(unknown).not.toContain('FETCH (');
    expect(await t.command('K', 'FETCH 1:2 (UID RFC822.SIZE)')).toMatch(
      /\* 1 FETCH \(UID \d+ RFC822\.SIZE \d+\)/,
    );
  });

  it('searches with UTF-8 and refuses other charsets', async () => {
    await sendMail({ port: server.smtpPort }, { subject: 'Grüße und Küsse' });
    const t = await ImapTranscript.loggedIn(port);
    await t.command('S', 'SELECT INBOX');
    expect(
      await t.command('A', 'SEARCH CHARSET ISO-8859-1 SUBJECT test'),
    ).toMatch(/^A NO \[BADCHARSET \(US-ASCII UTF-8\)\]/m);
    const word = Buffer.from('Küsse', 'utf8');
    t.write(`B SEARCH CHARSET UTF-8 SUBJECT {${word.length}}\r\n`);
    await t.readUntil((text) => text.startsWith('+ '));
    t.write(`${word.toString('latin1')}\r\n`);
    expect(await t.tagged('B')).toContain('* SEARCH 1\r\n');
  });

  it('pushes new mail during IDLE', async () => {
    const t = await ImapTranscript.loggedIn(port);
    await t.command('S', 'SELECT INBOX');
    t.write('I IDLE\r\n');
    await t.readUntil((text) => text.startsWith('+ '));
    await sendMail({ port: server.smtpPort }, { subject: 'while idle' });
    expect(await t.readUntil((text) => text.includes('EXISTS'))).toContain(
      '* 1 EXISTS',
    );
    t.write('DONE\r\n');
    expect(await t.tagged('I')).toMatch(/^I OK/m);
  });
});

describe('IMAP sessions', () => {
  it('limits sessions to 20 and answers the next one with BYE', async () => {
    const server = await startServerProcess({ args: ['--imap'] });
    const port = imapPort(server);
    for (let index = 0; index < 20; index++) await ImapTranscript.open(port);
    const { greeting } = await ImapTranscript.open(port);
    expect(greeting).toBe('* BYE [UNAVAILABLE] Too many connections\r\n');
    await server.stop();
  }, 30_000);

  it('says BYE to connected clients when the server stops', async () => {
    const server = await startServerProcess({ args: ['--imap'] });
    const t = await ImapTranscript.loggedIn(imapPort(server));
    await t.command('S', 'SELECT INBOX');
    const stopped = server.stop();
    expect(await t.readUntil((text) => text.includes('* BYE'))).toContain(
      'Server shutting down',
    );
    expect(await stopped).toBe(0);
  }, 30_000);
});
