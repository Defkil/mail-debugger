import { createApiClient } from '@mail-debugger/client';
import type { ImapFlowOptions } from 'imapflow';
import {
  ATTACHMENT_BYTES,
  closeImapClients,
  imapClient,
  imapPort,
  multipartFixture,
  readAll,
  sha256,
} from '../helpers/imap.js';
import { api, sendMail } from '../helpers/mail.js';
import {
  bridgeClient,
  callTool,
  closeMcpClients,
  mcpClient,
  mcpUrl,
} from '../helpers/mcp.js';
import {
  BINARIES,
  removeTempDirs,
  runBinary,
  startServerProcess,
  stopAllServers,
} from '../helpers/server.js';
import {
  createTrustedCertificate,
  type TrustedCertificate,
} from '../helpers/tls.js';

/**
 * One multipart message per TLS mode, sent over SMTP and read back through
 * every surface: the REST API, the JavaScript client, both terminal
 * clients, IMAP, MCP over HTTP and the stdio bridge. With TLS the clients
 * verify a configured certificate and SMTP and IMAP require the configured
 * account; without TLS the local development profile applies.
 */
const MODES = ['none', 'starttls', 'implicit'] as const;
type Mode = (typeof MODES)[number];

const ACCOUNT = { user: 'readback', pass: 'readback-secret' };

/** The header fields every surface reports for the multipart fixture. */
const HEADERS = {
  from: 'sender@example.test',
  to: ['recipient@example.test', 'other@example.test'],
  cc: ['copy@example.test'],
  subject: 'Grüße aus dem Test',
};
/** The decoded text part of the fixture. */
const TEXT = 'Grüße — the body.';
const ENVELOPE = {
  from: 'sender@example.test',
  // The second recipient appears in no header, like a Bcc.
  to: ['recipient@example.test', 'hidden@example.test'],
};

let certificate: TrustedCertificate;

beforeAll(async () => {
  certificate = await createTrustedCertificate();
});

afterEach(async () => {
  closeImapClients();
  await closeMcpClients();
});

afterAll(async () => {
  await stopAllServers();
  removeTempDirs();
});

function imapOptions(tls: Mode): Partial<ImapFlowOptions> {
  if (tls === 'none') return {};
  const trust = { ca: certificate.cert, servername: 'localhost' };
  return {
    auth: ACCOUNT,
    tls: trust,
    ...(tls === 'implicit' ? { secure: true } : { doSTARTTLS: true }),
  };
}

describe.each(MODES)('one message on every surface, TLS %s', (tls) => {
  it('reads the same message through REST, the client, both CLIs, IMAP and MCP', async () => {
    const secured = tls !== 'none';
    const server = await startServerProcess({
      args: [
        '--imap',
        '--mcp',
        '--tls',
        tls,
        ...(secured ? [...certificate.args, '--auth-user', ACCOUNT.user] : []),
      ],
      env: secured ? { MAIL_DEBUGGER_AUTH_PASSWORD: ACCOUNT.pass } : {},
    });
    const messageId = `<readback-${tls}@example.test>`;
    const raw = multipartFixture({ messageId });
    const rawHash = sha256(raw);
    const attachmentHash = sha256(ATTACHMENT_BYTES);
    const parsed = { messageId, ...HEADERS };

    await sendMail(
      {
        port: server.smtpPort,
        tls,
        ...(secured && { ca: certificate.cert, auth: ACCOUNT }),
      },
      { raw, ...ENVELOPE },
    );

    // REST API
    const list = await api(server.baseUrl, '/api/emails');
    expect(list.body.total).toBe(1);
    const id = list.body.data[0].id as number;
    const rest = (await api(server.baseUrl, `/api/emails/${id}`)).body.data;
    expect(rest).toMatchObject({
      ...parsed,
      textBody: TEXT,
      envelope: ENVELOPE,
    });
    const restRaw = await fetch(`${server.baseUrl}/api/emails/${id}/raw`);
    expect(sha256(new Uint8Array(await restRaw.arrayBuffer()))).toBe(rawHash);
    const restAttachment = await fetch(
      `${server.baseUrl}/api/emails/${id}/attachments/0`,
    );
    expect(sha256(new Uint8Array(await restAttachment.arrayBuffer()))).toBe(
      attachmentHash,
    );

    // JavaScript client
    const client = createApiClient(server.baseUrl);
    expect(await client.getEmail(id)).toMatchObject({
      ...parsed,
      textBody: TEXT,
      envelope: ENVELOPE,
    });
    expect(sha256(await client.getRawEmail(id))).toBe(rawHash);
    const download = await client.getAttachment(id, 0);
    expect(download).toMatchObject({
      filename: 'bytes.bin',
      contentType: 'application/octet-stream',
    });
    expect(sha256(download.bytes)).toBe(attachmentHash);

    // Both terminal clients, as JSON
    for (const [binary, prefix] of [
      [BINARIES.full, ['cli']],
      [BINARIES.cli, []],
    ] as const) {
      const shown = await runBinary(
        [...prefix, '--api-url', server.baseUrl, 'show', String(id), '--json'],
        { binary },
      );
      expect(shown).toMatchObject({ code: 0, stderr: '' });
      const email = JSON.parse(shown.stdout) as {
        attachments: { content: string }[];
      };
      expect(email).toMatchObject({ id, ...parsed, textBody: TEXT });
      expect(
        sha256(Buffer.from(email.attachments[0]?.content ?? '', 'base64')),
      ).toBe(attachmentHash);
    }

    // IMAP
    const imap = imapClient(imapPort(server), imapOptions(tls));
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    const message = await imap.fetchOne('*', { source: true, envelope: true });
    if (!message || !message.source) throw new Error('No message over IMAP');
    expect(sha256(message.source)).toBe(rawHash);
    expect(message.envelope).toMatchObject({
      messageId,
      subject: HEADERS.subject,
      from: [{ address: HEADERS.from }],
      to: HEADERS.to.map((address) => ({ address })),
      cc: HEADERS.cc.map((address) => ({ address })),
    });
    const text = await readAll((await imap.download('*', '1')).content);
    expect(text.toString('utf8')).toBe(TEXT);
    const attachment = await readAll((await imap.download('*', '2')).content);
    expect(sha256(attachment)).toBe(attachmentHash);
    await imap.logout();

    // MCP over HTTP and through the stdio bridge
    const url = mcpUrl(server);
    const viaHttp = await mcpClient(url, { modern: true });
    const { client: viaBridge } = await bridgeClient(url, { modern: true });
    for (const mcp of [viaHttp, viaBridge]) {
      const email = await callTool(mcp, 'get_email', { id });
      expect(email.result.isError).toBeFalsy();
      expect(email.data).toMatchObject({
        id,
        ...parsed,
        body: { format: 'text', content: TEXT, truncated: false },
        envelope: ENVELOPE,
      });
      const chunk = await callTool(mcp, 'get_email_attachment', {
        id,
        index: 0,
      });
      expect(chunk.data).toMatchObject({ truncated: false, nextOffset: null });
      expect(sha256(Buffer.from(chunk.data.dataBase64, 'base64'))).toBe(
        attachmentHash,
      );
    }

    expect(await server.stop()).toBe(0);
    if (secured) expect(server.output()).not.toContain(ACCOUNT.pass);
  }, 60_000);
});
