import fs from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';
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
  runBinary,
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

function capabilities(response: string): string[] {
  const line = /^\* CAPABILITY (.*)\r$/m.exec(response);
  if (!line) throw new Error(`No CAPABILITY response in:\n${response}`);
  return line[1].split(' ');
}

const plain = (user: string, password: string, authzid = '') =>
  Buffer.from(`${authzid}\0${user}\0${password}`).toString('base64');

describe('IMAP with STARTTLS', () => {
  it('requires the upgrade before any login and changes its capabilities', async () => {
    const server = await startServerProcess({
      args: ['--imap', '--tls', 'starttls'],
    });
    const port = imapPort(server);
    const { transcript } = await ImapTranscript.open(port);
    const before = capabilities(await transcript.command('A', 'CAPABILITY'));
    expect(before).toContain('STARTTLS');
    expect(before).toContain('LOGINDISABLED');
    expect(before).not.toContain('AUTH=PLAIN');
    expect(before).not.toContain('SASL-IR');

    expect(
      await transcript.command('B', 'LOGIN mail-debugger mail-debugger'),
    ).toMatch(/^B NO \[PRIVACYREQUIRED\]/m);
    expect(
      await transcript.command(
        'C',
        `AUTHENTICATE PLAIN ${plain('mail-debugger', 'mail-debugger')}`,
      ),
    ).toMatch(/^C NO \[PRIVACYREQUIRED\]/m);
    const noContinuation = await transcript.command('D', 'AUTHENTICATE PLAIN');
    expect(noContinuation).toMatch(/^D NO \[PRIVACYREQUIRED\]/m);
    expect(noContinuation).not.toContain('+ ');
    expect(await transcript.command('E', 'AUTHENTICATE XOAUTH2')).toMatch(
      /^E NO \[PRIVACYREQUIRED\]/m,
    );

    expect(await transcript.command('F', 'STARTTLS')).toMatch(/^F OK/m);
    await transcript.startTls();
    const after = capabilities(await transcript.command('G', 'CAPABILITY'));
    expect(after).toContain('AUTH=PLAIN');
    expect(after).toContain('SASL-IR');
    expect(after).not.toContain('STARTTLS');
    expect(after).not.toContain('LOGINDISABLED');
    expect(
      await transcript.command('H', 'LOGIN mail-debugger mail-debugger'),
    ).toMatch(/^H OK/m);

    await sendMail(
      { port: server.smtpPort, tls: 'starttls' },
      { subject: 'tls' },
    );
    const client = imapClient(port, {
      doSTARTTLS: true,
      tls: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const message = await client.fetchOne('1', { envelope: true });
    expect(message && message.envelope?.subject).toBe('tls');
    await client.logout();
    await server.stop();
  }, 30_000);

  it('accepts only the configured account, also for SMTP', async () => {
    const server = await startServerProcess({
      args: ['--imap', '--tls', 'starttls', '--auth-user', 'dev'],
      env: { MAIL_DEBUGGER_AUTH_PASSWORD: 'imap-e2e-secret' },
    });
    const port = imapPort(server);
    await sendMail(
      {
        port: server.smtpPort,
        tls: 'starttls',
        auth: { user: 'dev', pass: 'imap-e2e-secret' },
      },
      { subject: 'authenticated' },
    );

    const { transcript } = await ImapTranscript.open(port);
    await transcript.command('S', 'STARTTLS');
    await transcript.startTls();
    expect(
      await transcript.command('A', 'LOGIN mail-debugger mail-debugger'),
    ).toMatch(/^A NO \[AUTHENTICATIONFAILED\]/m);
    expect(await transcript.command('B', 'LOGIN dev wrong')).toMatch(
      /^B NO \[AUTHENTICATIONFAILED\]/m,
    );
    expect(
      await transcript.command(
        'C',
        `AUTHENTICATE PLAIN ${plain('dev', 'imap-e2e-secret', 'other')}`,
      ),
    ).toMatch(/^C NO \[AUTHORIZATIONFAILED\]/m);
    expect(await transcript.command('D', 'AUTHENTICATE PLAIN !!!')).toMatch(
      /^D BAD/m,
    );
    transcript.write('E AUTHENTICATE PLAIN\r\n');
    await transcript.readUntil((text) => text.startsWith('+ '));
    transcript.write(`${plain('dev', 'imap-e2e-secret')}\r\n`);
    expect(await transcript.tagged('E')).toMatch(/^E OK/m);

    const client = imapClient(port, {
      doSTARTTLS: true,
      tls: { rejectUnauthorized: false },
      auth: { user: 'dev', pass: 'imap-e2e-secret' },
    });
    await client.connect();
    expect((await client.mailboxOpen('INBOX')).exists).toBe(1);
    await client.logout();

    const refused = imapClient(port, {
      doSTARTTLS: true,
      tls: { rejectUnauthorized: false },
    });
    await expect(refused.connect()).rejects.toMatchObject({
      authenticationFailed: true,
    });
    expect(server.output()).not.toContain('imap-e2e-secret');
    await server.stop();
  }, 30_000);

  it('refuses configured credentials over plaintext IMAP unless explicitly allowed', async () => {
    const refused = await runBinary(['--imap', '--auth-user', 'dev'], {
      env: { MAIL_DEBUGGER_AUTH_PASSWORD: 'secret' },
    });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--allow-insecure-auth');

    const server = await startServerProcess({
      args: ['--imap', '--auth-user', 'dev', '--allow-insecure-auth'],
      env: { MAIL_DEBUGGER_AUTH_PASSWORD: 'secret' },
    });
    const { transcript } = await ImapTranscript.open(imapPort(server));
    const caps = capabilities(await transcript.command('A', 'CAPABILITY'));
    expect(caps).toContain('AUTH=PLAIN');
    expect(caps).not.toContain('LOGINDISABLED');
    expect(await transcript.command('B', 'LOGIN dev secret')).toMatch(/^B OK/m);
    await server.stop();
  }, 30_000);
});

describe('IMAP with implicit TLS', () => {
  it('serves IMAPS with the generated certificate, which clients must trust explicitly', async () => {
    const server = await startServerProcess({
      args: ['--imap', '--tls', 'implicit'],
    });
    const port = imapPort(server);
    await sendMail(
      { port: server.smtpPort, tls: 'implicit' },
      { subject: 'implicit' },
    );

    const { transcript } = await ImapTranscript.open(port, { tls: true });
    const caps = capabilities(await transcript.command('A', 'CAPABILITY'));
    expect(caps).toContain('AUTH=PLAIN');
    expect(caps).not.toContain('STARTTLS');
    expect(caps).not.toContain('LOGINDISABLED');

    const client = imapClient(port, {
      secure: true,
      tls: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    expect(await client.fetchOne('1', { envelope: true })).toMatchObject({
      envelope: { subject: 'implicit' },
    });
    await client.logout();

    const verifying = imapClient(port, { secure: true });
    await expect(verifying.connect()).rejects.toThrow(/certificate/i);
    await server.stop();
  }, 30_000);

  it('uses configured certificate files that clients can trust', async () => {
    const dir = makeTempDir();
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'localhost' }],
      {
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [{ type: 2, value: 'localhost' }],
          },
        ],
      },
    );
    const certFile = path.join(dir, 'cert.pem');
    const keyFile = path.join(dir, 'key.pem');
    fs.writeFileSync(certFile, pems.cert);
    fs.writeFileSync(keyFile, pems.private);

    const server = await startServerProcess({
      args: [
        '--imap',
        '--tls',
        'implicit',
        '--tls-cert',
        certFile,
        '--tls-key',
        keyFile,
      ],
    });
    const client = imapClient(imapPort(server), {
      secure: true,
      tls: { ca: pems.cert, servername: 'localhost' },
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    await client.logout();
    await server.stop();
  }, 30_000);
});
