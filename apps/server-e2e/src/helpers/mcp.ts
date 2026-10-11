import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { BINARIES, type ServerProcess } from './server.js';

const clients = new Set<Client>();

/** The MCP endpoint of a server started with --mcp. */
export function mcpUrl(server: ServerProcess): URL {
  return new URL(`${server.baseUrl}/mcp`);
}

export interface McpClientOptions {
  /** Negotiate protocol 2026-07-28; otherwise the client speaks 2025-11-25. */
  modern?: boolean;
  token?: string;
}

/** An SDK client connected over streamable HTTP. */
export async function mcpClient(
  url: URL,
  options: McpClientOptions = {},
): Promise<Client> {
  const client = new Client(
    { name: 'mail-debugger-e2e', version: '0.0.0' },
    options.modern ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  clients.add(client);
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: options.token
          ? { authorization: `Bearer ${options.token}` }
          : {},
      },
    }),
  );
  return client;
}

/** An SDK client connected to a spawned `mail-debugger mcp` bridge. */
export async function bridgeClient(
  url: URL,
  options: { modern?: boolean; env?: Record<string, string> } = {},
): Promise<{ client: Client; stderr: () => string }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BINARIES.full, 'mcp', '--url', url.href],
    env: { ...(process.env as Record<string, string>), ...options.env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const client = new Client(
    { name: 'mail-debugger-e2e-stdio', version: '0.0.0' },
    options.modern ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  clients.add(client);
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

export async function closeMcpClients(): Promise<void> {
  await Promise.allSettled([...clients].map((client) => client.close()));
  clients.clear();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read the structured results
export type ToolData = any;

/** Calls a tool and returns the result with its structured content. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<{ result: CallToolResult; data: ToolData }> {
  const result = (await client.callTool(
    { name, arguments: args },
    options,
  )) as CallToolResult;
  return { result, data: result.structuredContent };
}

/** A raw JSON-RPC POST to an MCP endpoint. */
export async function postJsonRpc(
  url: URL,
  message: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(message),
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
}

/** The JSON-RPC messages of a JSON or server-sent-events response body. */
export function jsonRpcMessages(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  return trimmed.startsWith('{')
    ? [JSON.parse(trimmed) as Record<string, unknown>]
    : trimmed
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map(
          (line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>,
        );
}
