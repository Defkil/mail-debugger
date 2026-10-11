import http from 'node:http';
import {
  ATTACHMENT_BYTES,
  closeImapClients,
  imapClient,
  imapPort,
  multipartFixture,
  sha256,
} from '../helpers/imap.js';
import { api, sendMail } from '../helpers/mail.js';
import {
  callTool,
  closeMcpClients,
  jsonRpcMessages,
  mcpClient,
  mcpUrl,
  postJsonRpc,
} from '../helpers/mcp.js';
import {
  BINARIES,
  runBinary,
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

const READ_TOOLS = [
  'list_emails',
  'search_emails',
  'get_email',
  'wait_for_email',
  'list_email_attachments',
  'get_email_attachment',
];

afterEach(async () => {
  await closeMcpClients();
  closeImapClients();
});

afterAll(async () => {
  await stopAllServers();
});

/** A POST to /mcp with exactly these headers (fetch sets Host itself). */
function rawPost(
  port: number,
  headers: Record<string, string>,
  body: string,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const initialize = (protocolVersion: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'fixture', version: '1.0.0' },
  },
});

describe('MCP over HTTP', () => {
  let server: ServerProcess;
  let url: URL;

  beforeAll(async () => {
    server = await startServerProcess({ args: ['--mcp'] });
    url = mcpUrl(server);
  }, 30_000);

  beforeEach(async () => {
    await api(server.baseUrl, '/api/emails', { method: 'DELETE' });
  });

  it('serves modern and 2025-era clients with the six read tools', async () => {
    const { version } = (await api(server.baseUrl, '/api/health')).body;
    expect((await api(server.baseUrl, '/api/health')).body.mcp).toBe(true);
    for (const modern of [true, false]) {
      const client = await mcpClient(url, { modern });
      expect(client.getServerVersion()).toMatchObject({
        name: 'mail-debugger',
        version,
      });
      expect(client.getInstructions()).toMatch(/untrusted/);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(READ_TOOLS);
      expect(
        tools.every(
          (tool) =>
            tool.annotations?.readOnlyHint === true &&
            tool.annotations.destructiveHint === false &&
            tool.inputSchema.additionalProperties === false,
        ),
      ).toBe(true);
    }
  });

  it.each(['2025-06-18', '2025-11-25'])(
    'answers a raw %s initialization and tool listing',
    async (protocolVersion) => {
      const init = await postJsonRpc(url, initialize(protocolVersion));
      expect(init.status).toBe(200);
      expect(jsonRpcMessages(init.text)[0]).toMatchObject({
        id: 1,
        result: {
          protocolVersion,
          serverInfo: { name: 'mail-debugger' },
          capabilities: { tools: {} },
        },
      });
      const list = await postJsonRpc(
        url,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'mcp-protocol-version': protocolVersion },
      );
      const [message] = jsonRpcMessages(list.text) as {
        result: { tools: { name: string }[] };
      }[];
      expect(message.result.tools.map((tool) => tool.name)).toEqual(READ_TOOLS);
    },
  );

  it('reads an SMTP multipart message like the REST API does', async () => {
    await sendMail(
      { port: server.smtpPort },
      {
        raw: multipartFixture(),
        from: 'sender@example.test',
        to: 'recipient@example.test',
      },
    );
    const client = await mcpClient(url, { modern: true });
    const list = await callTool(client, 'list_emails');
    const [summary] = list.data.data;
    const rest = (await api(server.baseUrl, `/api/emails/${summary.id}`)).body
      .data;

    const email = await callTool(client, 'get_email', { id: summary.id });
    expect(email.data).toMatchObject({
      id: rest.id,
      messageId: rest.messageId,
      from: rest.from,
      to: rest.to,
      cc: rest.cc,
      subject: 'Grüße aus dem Test',
      body: { format: 'text', content: rest.textBody, truncated: false },
      attachments: [
        {
          index: 0,
          filename: 'bytes.bin',
          size: 4,
          contentType: 'application/octet-stream',
        },
      ],
    });
    expect(email.data.envelope).toEqual(rest.envelope);

    const chunk = await callTool(client, 'get_email_attachment', {
      id: summary.id,
      index: 0,
    });
    const bytes = Buffer.from(chunk.data.dataBase64, 'base64');
    expect(bytes.equals(ATTACHMENT_BYTES)).toBe(true);
    const download = Buffer.from(
      await (
        await fetch(`${server.baseUrl}/api/emails/${summary.id}/attachments/0`)
      ).arrayBuffer(),
    );
    expect(sha256(bytes)).toBe(sha256(download));
  });

  it('waits for new mail and frees the waits a client cancels', async () => {
    const client = await mcpClient(url, { modern: true });
    const waiting = callTool(client, 'wait_for_email', { timeoutMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await sendMail({ port: server.smtpPort }, { subject: 'awaited' });
    expect((await waiting).data).toMatchObject({
      email: { subject: 'awaited' },
      timedOut: false,
    });

    const controllers = Array.from({ length: 32 }, () => new AbortController());
    const pending = controllers.map(async (controller) => {
      try {
        return await callTool(
          client,
          'wait_for_email',
          { timeoutMs: 30_000 },
          { signal: controller.signal },
        );
      } catch (error) {
        return error;
      }
    });
    const probe = async () =>
      (await callTool(client, 'wait_for_email', { timeoutMs: 0 })).data;
    await vi.waitFor(
      async () => expect((await probe()).error?.code).toBe('LIMIT_EXCEEDED'),
      { timeout: 10_000, interval: 100 },
    );
    for (const controller of controllers) controller.abort();
    await Promise.all(pending);
    // Closing the HTTP requests ended the waits on the server.
    await vi.waitFor(async () => expect((await probe()).timedOut).toBe(true), {
      timeout: 10_000,
      interval: 100,
    });
  }, 30_000);

  it('refuses foreign hosts and origins, oversized bodies and other methods', async () => {
    const body = JSON.stringify(initialize('2025-11-25'));
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const host = `127.0.0.1:${server.apiPort}`;
    const foreignHost = await rawPost(
      server.apiPort,
      {
        ...headers,
        host: `rebind.example:${server.apiPort}`,
      },
      body,
    );
    expect(foreignHost.status).toBe(403);
    expect(JSON.parse(foreignHost.body)).toMatchObject({
      error: { code: 'FORBIDDEN_HOST' },
    });
    const foreignOrigin = await rawPost(
      server.apiPort,
      {
        ...headers,
        host,
        origin: 'https://evil.example',
      },
      body,
    );
    expect(foreignOrigin.status).toBe(403);
    const ownOrigin = await rawPost(
      server.apiPort,
      {
        ...headers,
        host,
        origin: `http://${host}`,
      },
      body,
    );
    expect(ownOrigin.status).toBe(200);

    const oversized = await postJsonRpc(url, {
      ...initialize('2025-11-25'),
      padding: 'x'.repeat(70 * 1024),
    });
    expect(oversized.status).toBe(413);
    expect((await fetch(url)).status).toBe(405);
    const unknown = await api(server.baseUrl, '/mcp/sse');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('MCP options', () => {
  it('requires MAIL_DEBUGGER_MCP_TOKEN when it is set', async () => {
    const server = await startServerProcess({
      args: ['--mcp'],
      env: { MAIL_DEBUGGER_MCP_TOKEN: 'e2e-mcp-token' },
    });
    const url = mcpUrl(server);
    const refused = await postJsonRpc(url, initialize('2025-11-25'));
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain('Bearer');
    const wrong = await postJsonRpc(url, initialize('2025-11-25'), {
      authorization: 'Bearer nope',
    });
    expect(wrong.status).toBe(401);
    await expect(mcpClient(url)).rejects.toThrow();

    const client = await mcpClient(url, {
      token: 'e2e-mcp-token',
      modern: true,
    });
    expect((await client.listTools()).tools).toHaveLength(6);
    // The REST API keeps its own token rule: none is configured here.
    expect((await api(server.baseUrl, '/api/emails')).status).toBe(200);
    expect(server.output()).not.toContain('e2e-mcp-token');
    await server.stop();
  }, 30_000);

  it('refuses MCP beyond loopback without a token and mutations without --mcp', async () => {
    const remote = await runBinary(
      ['--host', '0.0.0.0', '--tls', 'starttls', '--auth-user', 'dev', '--mcp'],
      {
        env: {
          MAIL_DEBUGGER_AUTH_PASSWORD: 'pw',
          MAIL_DEBUGGER_API_TOKEN: 'api',
        },
      },
    );
    expect(remote.code).toBe(2);
    expect(remote.stderr).toContain('MAIL_DEBUGGER_MCP_TOKEN');
    const mutations = await runBinary(['--mcp-allow-mutations']);
    expect(mutations.code).toBe(2);
    expect(mutations.stderr).toContain('--mcp-allow-mutations needs --mcp');
  });

  it('offers deletions only when allowed and applies them on every surface', async () => {
    const server = await startServerProcess({
      args: ['--mcp', '--mcp-allow-mutations', '--imap'],
    });
    await sendMail({ port: server.smtpPort }, { subject: 'kept' });
    await sendMail({ port: server.smtpPort }, { subject: 'deleted over MCP' });
    const imap = imapClient(imapPort(server));
    await imap.connect();
    await imap.mailboxOpen('INBOX');

    const client = await mcpClient(mcpUrl(server), { modern: true });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      ...READ_TOOLS,
      'delete_email',
      'clear_emails',
    ]);
    const list = await callTool(client, 'list_emails');
    const target = list.data.data.find(
      (email: { subject: string }) => email.subject === 'deleted over MCP',
    );
    const expunge = new Promise<{ seq: number }>((resolve) =>
      imap.once('expunge', resolve),
    );
    expect(
      (await callTool(client, 'delete_email', { id: target.id, confirm: true }))
        .data,
    ).toEqual({ deleted: true, id: target.id });
    await imap.noop();
    expect((await expunge).seq).toBe(2);
    expect((await api(server.baseUrl, '/api/emails')).body.total).toBe(1);

    const changed = await callTool(client, 'clear_emails', {
      confirm: true,
      expectedCount: 2,
    });
    expect(changed.data.error.code).toBe('COUNT_CHANGED');
    expect(
      (
        await callTool(client, 'clear_emails', {
          confirm: true,
          expectedCount: 1,
        })
      ).data,
    ).toEqual({ deleted: 1 });
    expect((await api(server.baseUrl, '/api/emails')).body.total).toBe(0);
    await imap.logout();
    await server.stop();
  }, 30_000);

  it('answers /mcp with JSON 404 when MCP is off and serves it from the slim build', async () => {
    const plain = await startServerProcess();
    const off = await api(plain.baseUrl, '/mcp', { method: 'POST' });
    expect(off.status).toBe(404);
    expect(off.body.error.message).toContain('--mcp');
    await plain.stop();

    const slim = await startServerProcess({
      args: ['--mcp'],
      binary: BINARIES.api,
    });
    const client = await mcpClient(mcpUrl(slim));
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      READ_TOOLS,
    );
    await client.close();
    await slim.stop();
  }, 30_000);
});
