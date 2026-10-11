import { spawn } from 'node:child_process';
import net from 'node:net';
import { sendMail } from '../helpers/mail.js';
import {
  bridgeClient,
  callTool,
  closeMcpClients,
  mcpClient,
  mcpUrl,
} from '../helpers/mcp.js';
import {
  BINARIES,
  runBinary,
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

afterEach(async () => {
  await closeMcpClients();
});

afterAll(async () => {
  await stopAllServers();
});

interface BridgeProcess {
  /** Sends one JSON-RPC message as a line on stdin. */
  send(message: unknown): void;
  /** Writes incomplete or malformed protocol input. */
  write(text: string): void;
  /** Resolves with the next JSON-RPC message on stdout that has `id`. */
  response(id: number): Promise<Record<string, unknown>>;
  stdoutLines(): string[];
  stderr(): string;
  closeStdin(): void;
  exited: Promise<number | null>;
}

/** Spawns `mail-debugger mcp` with plain pipes, without an SDK client. */
function spawnBridge(args: string[]): BridgeProcess {
  const child = spawn(process.execPath, [BINARIES.full, 'mcp', ...args], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const waiters = new Set<() => void>();
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    for (const waiter of waiters) waiter();
  });
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  // 'close' waits for stdout and stderr to end, unlike 'exit'.
  const exited = new Promise<number | null>((resolve) =>
    child.once('close', (code) => resolve(code)),
  );
  // Complete lines only: a chunk may end inside a message.
  const lines = () =>
    stdout
      .split('\n')
      .slice(0, -1)
      .filter((line) => line.trim() !== '');
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    write: (text) => child.stdin.write(text),
    response: (id) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(
            new Error(
              `No response ${id}; stdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
        }, 15_000);
        const check = () => {
          for (const line of lines()) {
            const message = JSON.parse(line) as Record<string, unknown>;
            if (message['id'] === id) {
              clearTimeout(timer);
              waiters.delete(check);
              resolve(message);
              return;
            }
          }
        };
        waiters.add(check);
        check();
      }),
    stdoutLines: lines,
    stderr: () => stderr,
    closeStdin: () => child.stdin.end(),
    exited,
  };
}

describe('MCP stdio bridge', () => {
  let server: ServerProcess;
  let url: URL;

  beforeAll(async () => {
    server = await startServerProcess({ args: ['--mcp'] });
    url = mcpUrl(server);
  }, 30_000);

  it('forwards the tools of the server to stdio clients of either era', async () => {
    await sendMail({ port: server.smtpPort }, { subject: 'over stdio' });
    const direct = await mcpClient(url, { modern: true });
    const upstream = await direct.listTools();
    for (const modern of [false, true]) {
      const { client } = await bridgeClient(url, { modern });
      expect(client.getServerVersion()).toMatchObject({
        name: 'mail-debugger',
      });
      expect(client.getInstructions()).toMatch(/untrusted/);
      const { tools } = await client.listTools();
      expect(tools).toEqual(upstream.tools);
      const list = await callTool(client, 'search_emails', {
        filter: { subject: 'over stdio' },
      });
      expect(list.data.data).toHaveLength(1);
      const missing = await callTool(client, 'get_email', { id: 999_999 });
      expect(missing.data.error.code).toBe('EMAIL_NOT_FOUND');
      const invalid = await callTool(client, 'list_emails', { limit: 0 });
      expect(invalid.result.isError).toBe(true);
      await expect(
        client.callTool({
          name: 'delete_email',
          arguments: { id: 1, confirm: true },
        }),
      ).rejects.toThrow(/not found/);
    }
  }, 60_000);

  it('passes cancellation upstream, so the server frees the wait', async () => {
    const { client } = await bridgeClient(url);
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
    const direct = await mcpClient(url, { modern: true });
    const probe = async () =>
      (await callTool(direct, 'wait_for_email', { timeoutMs: 0 })).data;
    await vi.waitFor(
      async () => expect((await probe()).error?.code).toBe('LIMIT_EXCEEDED'),
      { timeout: 10_000, interval: 100 },
    );
    for (const controller of controllers) controller.abort();
    await Promise.all(pending);
    await vi.waitFor(async () => expect((await probe()).timedOut).toBe(true), {
      timeout: 10_000,
      interval: 100,
    });
  }, 60_000);

  it('writes only protocol messages to stdout and exits when stdin closes', async () => {
    const bridge = spawnBridge(['--url', url.href]);
    bridge.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1.0.0' },
      },
    });
    expect(await bridge.response(1)).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    });
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = (await bridge.response(2)) as {
      result: { tools: unknown[] };
    };
    expect(list.result.tools).toHaveLength(6);
    bridge.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_emails', arguments: { limit: 1 } },
    });
    expect(await bridge.response(3)).toHaveProperty('result.structuredContent');

    bridge.closeStdin();
    expect(await bridge.exited).toBe(0);
    for (const line of bridge.stdoutLines()) {
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
    }
    // The log transport writes asynchronously; all of it is there on exit.
    expect(bridge.stderr()).toContain('MCP bridge ready');
  }, 30_000);

  it('exits when oversized stdin closes the protocol transport', async () => {
    const bridge = spawnBridge(['--url', url.href]);
    // A message with no terminating LF cannot grow the bridge indefinitely.
    bridge.write('x'.repeat(65 * 1024));
    // Keep stdin open: transport failure itself must close the bridge.
    expect(await bridge.exited).toBe(0);
    expect(bridge.stdoutLines()).toEqual([]);
  }, 15_000);

  it('fails clearly when the server cannot be used', async () => {
    const unused = net.createServer();
    await new Promise<void>((resolve) =>
      unused.listen(0, '127.0.0.1', resolve),
    );
    const port = (unused.address() as net.AddressInfo).port;
    await new Promise((resolve) => unused.close(resolve));

    const unavailable = await runBinary([
      'mcp',
      '--url',
      `http://127.0.0.1:${port}/mcp`,
    ]);
    expect(unavailable.code).toBe(1);
    expect(unavailable.stdout).toBe('');
    expect(unavailable.stderr).toContain('cannot use the MCP endpoint');

    const usage = await runBinary(['mcp', '--frobnicate']);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("Unknown option '--frobnicate'");
    const help = await runBinary(['mcp', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: mail-debugger mcp [--url <url>]');
  }, 30_000);

  it('answers SERVER_UNAVAILABLE once the server has gone away', async () => {
    const shortLived = await startServerProcess({ args: ['--mcp'] });
    const { client } = await bridgeClient(mcpUrl(shortLived));
    await shortLived.stop();
    const { result, data } = await callTool(client, 'list_emails');
    expect(result.isError).toBe(true);
    expect(data.error.code).toBe('SERVER_UNAVAILABLE');
  }, 30_000);

  it('sends MAIL_DEBUGGER_MCP_TOKEN to a server that requires it', async () => {
    const protectedServer = await startServerProcess({
      args: ['--mcp'],
      env: { MAIL_DEBUGGER_MCP_TOKEN: 'e2e-bridge-token' },
    });
    const protectedUrl = mcpUrl(protectedServer);
    const refused = await runBinary(['mcp', '--url', protectedUrl.href]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('MAIL_DEBUGGER_MCP_TOKEN');

    const { client, stderr } = await bridgeClient(protectedUrl, {
      env: { MAIL_DEBUGGER_MCP_TOKEN: 'e2e-bridge-token' },
    });
    expect((await client.listTools()).tools).toHaveLength(6);
    // Closing waits for the bridge to exit, so stderr is complete.
    await client.close();
    expect(stderr()).toContain('MCP bridge ready');
    expect(stderr()).not.toContain('e2e-bridge-token');
    await protectedServer.stop();
  }, 30_000);
});
