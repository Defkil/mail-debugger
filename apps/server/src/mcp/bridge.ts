import { parseArgs } from 'node:util';
import {
  Client,
  ProtocolError,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/client';
import { Server } from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { createLogger, type Logger } from '../logger.js';
import { failure } from './tools.js';
import { MAX_MCP_BODY_BYTES } from './http.js';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:3000/mcp';
const TOKEN_VARIABLE = 'MAIL_DEBUGGER_MCP_TOKEN';
/** How long the bridge waits for the server when it starts. */
const STARTUP_TIMEOUT_MS = 10_000;
/** Longest tool call; wait_for_email waits at most 30 seconds. */
const CALL_TIMEOUT_MS = 60_000;
/** How long closing may take before the bridge exits anyway. */
const CLOSE_TIMEOUT_MS = 3000;

export interface BridgeProgram {
  /** Command name used in messages, e.g. "mail-debugger mcp". */
  name: string;
  version: string;
}

export function formatBridgeHelp(name: string): string {
  return [
    `Usage: ${name} [--url <url>]`,
    '',
    'Connects an MCP client that talks over stdio (for example Claude Code or',
    'Codex) to a running mail-debugger started with --mcp. It forwards the tools',
    'of that server; it opens no mailbox and no listener of its own. Protocol',
    'messages use stdin and stdout, diagnostics go to stderr.',
    '',
    'Options:',
    `  --url <url>   MCP endpoint of the server (default: ${DEFAULT_MCP_URL})`,
    '  -h, --help    Show this help',
    '  --version     Show the version',
    '',
    'Environment:',
    `  ${TOKEN_VARIABLE}  Bearer token, when the server requires one`,
    '',
  ].join('\n');
}

class UsageError extends Error {
  constructor(message: string) {
    super(diagnosticLine(message));
  }
}

type BridgeCommand =
  { kind: 'help' } | { kind: 'version' } | { kind: 'run'; url: URL };

function parseBridgeArgs(argv: readonly string[]): BridgeCommand {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        url: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(
      (error as Error).message.replace(/\. To specify .*$/s, ''),
    );
  }
  if (values['help']) return { kind: 'help' };
  if (values['version']) return { kind: 'version' };
  const raw =
    typeof values['url'] === 'string' ? values['url'] : DEFAULT_MCP_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`--url must be an http(s) URL, got "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`--url must be an http(s) URL, got "${raw}"`);
  }
  if (url.username || url.password) {
    throw new UsageError(
      `--url must not contain credentials; put the token in ${TOKEN_VARIABLE}`,
    );
  }
  return { kind: 'run', url };
}

/**
 * Runs `mail-debugger mcp`: an MCP stdio server that forwards the tools of
 * a running server's /mcp endpoint through the SDK client. Resolves with
 * the exit code: 0 after stdin closed, 1 when the server cannot be used,
 * 2 for usage errors.
 */
export async function runMcpBridge(
  argv: readonly string[],
  program: BridgeProgram,
): Promise<number> {
  let command: BridgeCommand;
  try {
    command = parseBridgeArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(
      `${program.name}: ${error.message}\nRun "${program.name} --help" for the options.\n`,
    );
    return 2;
  }
  if (command.kind === 'help') {
    process.stdout.write(formatBridgeHelp(program.name));
    return 0;
  }
  if (command.kind === 'version') {
    process.stdout.write(`${program.version}\n`);
    return 0;
  }

  const token = process.env[TOKEN_VARIABLE];
  if (token !== undefined && !/^\S+$/.test(token)) {
    process.stderr.write(
      `${program.name}: ${TOKEN_VARIABLE} must be a non-empty value without whitespace\n`,
    );
    return 2;
  }
  // stdout carries the protocol, so diagnostics go to stderr only.
  const log = createLogger({ destination: 'stderr' }).child({
    component: 'mcp-bridge',
  });

  const upstream = new Client(
    { name: 'mail-debugger-mcp-bridge', version: program.version },
    // The 2026-07-28 protocol carries cancellation upstream by closing the
    // HTTP request; older servers are reached through the fallback.
    { versionNegotiation: { mode: 'auto' } },
  );
  let tools: Tool[];
  try {
    await upstream.connect(
      new StreamableHTTPClientTransport(command.url, {
        requestInit: {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        },
      }),
      { timeout: STARTUP_TIMEOUT_MS },
    );
    ({ tools } = await upstream.listTools(undefined, {
      timeout: STARTUP_TIMEOUT_MS,
    }));
  } catch (error) {
    process.stderr.write(
      `${program.name}: cannot use the MCP endpoint ${command.url.href}: ${describe(error)}. Start mail-debugger with --mcp${token ? '' : `, and set ${TOKEN_VARIABLE} if it requires a token`}.\n`,
    );
    await closeQuietly(() => upstream.close());
    return 1;
  }
  const instructions = upstream.getInstructions();
  log.info(
    { url: command.url.href, tools: tools.map((tool) => tool.name) },
    'MCP bridge ready',
  );

  let finish!: () => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- the project's ES2022 types do not include withResolvers
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: MAX_MCP_BODY_BYTES,
  });
  const handle = serveStdio(
    () => {
      const server = new Server(
        { name: 'mail-debugger', version: program.version },
        {
          capabilities: { tools: { listChanged: false } },
          ...(instructions && { instructions }),
        },
      );
      server.setRequestHandler('tools/list', () => ({ tools }));
      server.setRequestHandler('tools/call', (request, ctx) =>
        forward(upstream, request.params, ctx.mcpReq.signal, log),
      );
      return server;
    },
    {
      transport,
      onerror: (error) => log.debug({ err: error }, 'MCP stdio error'),
    },
  );
  // The SDK also closes on oversized input or a failed stdout. Its close
  // callback tears down in-flight calls; then close the upstream client.
  const onTransportClose = transport.onclose;
  // eslint-disable-next-line unicorn/prefer-add-event-listener -- SDK Transport exposes callbacks, not EventTarget
  transport.onclose = () => {
    onTransportClose?.();
    finish();
  };
  process.once('SIGINT', finish);
  process.once('SIGTERM', finish);
  await finished;
  process.off('SIGINT', finish);
  process.off('SIGTERM', finish);
  await Promise.race([
    Promise.allSettled([handle.close(), upstream.close()]),
    new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref()),
  ]);
  return 0;
}

/**
 * Forwards a tool call. Errors the server answered stay protocol errors;
 * when the server cannot be reached the call fails with
 * SERVER_UNAVAILABLE. Calls are never retried.
 */
async function forward(
  upstream: Client,
  params: { name: string; arguments?: Record<string, unknown> },
  signal: AbortSignal,
  log: Logger,
): Promise<CallToolResult> {
  try {
    return await upstream.callTool(params, {
      signal,
      timeout: CALL_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ProtocolError || signal.aborted) throw error;
    log.warn(
      { err: error, tool: params.name },
      'The MCP server is unavailable',
    );
    return failure(
      'SERVER_UNAVAILABLE',
      `The mail-debugger server is unavailable: ${describe(error)}`,
    );
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The first line is enough; SDK errors can carry response bodies.
  return diagnosticLine(message.split('\n', 1)[0].slice(0, 300));
}

/** Arguments and remote errors must not execute terminal control sequences. */
function diagnosticLine(value: string): string {
  // eslint-disable-next-line no-control-regex -- diagnostics contain untrusted text
  return value.replaceAll(/[\u{0}-\u{1F}\u{7F}-\u{9F}]/gu, '\u{FFFD}');
}

async function closeQuietly(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    // Nothing to report: the bridge is failing already.
  }
}
