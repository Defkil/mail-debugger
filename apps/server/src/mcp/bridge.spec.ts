import { Client } from '@modelcontextprotocol/client';
import pino from 'pino';
import { runMcpBridge } from './bridge.js';

vi.mock('../logger.js', () => ({
  createLogger: () => pino({ level: 'silent' }),
}));

const program = { name: 'mail-debugger mcp', version: '0.4.0' };
const hostile = 'bad\u{1B}]52;c;cHduZWQ=\u{7}\u{9B}2J';
let stderr: string;

beforeEach(() => {
  stderr = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function expectSafeDiagnostic(): void {
  expect(stderr).toContain('\u{FFFD}]52;c;cHduZWQ=\u{FFFD}\u{FFFD}2J');
  expect(stderr).not.toContain('\u{1B}');
  expect(stderr).not.toContain('\u{7}');
  expect(stderr).not.toContain('\u{9B}');
}

it('sanitizes invalid command-line arguments before writing diagnostics', async () => {
  expect(await runMcpBridge(['--url', hostile], program)).toBe(2);
  expectSafeDiagnostic();
});

it('sanitizes an upstream error before writing the startup diagnostic', async () => {
  vi.spyOn(Client.prototype, 'connect').mockRejectedValue(new Error(hostile));
  expect(await runMcpBridge([], program)).toBe(1);
  expectSafeDiagnostic();
});

it.each(['secret\u{1B}token', 'secret\u{7F}token', 'secret\u{1F512}token'])(
  'rejects an invalid token without exposing it in a header error',
  async (token) => {
    vi.stubEnv('MAIL_DEBUGGER_MCP_TOKEN', token);
    const connect = vi.spyOn(Client.prototype, 'connect');
    expect(await runMcpBridge([], program)).toBe(2);
    expect(stderr).toContain('visible ASCII');
    expect(stderr).not.toContain('secret');
    expect(connect).not.toHaveBeenCalled();
  },
);
