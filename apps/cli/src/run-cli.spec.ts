import { runCli } from './run-cli.js';

const loadTerminalEngine = vi.fn<() => Promise<void>>();
const startTui = vi.fn<(client: unknown, apiUrl: string) => Promise<void>>();

vi.mock('./tui/app.js', () => ({
  loadTerminalEngine: () => loadTerminalEngine(),
  startTui: (client: unknown, apiUrl: string) => startTui(client, apiUrl),
}));

const program = { name: 'mail-debugger cli', version: '1.2.3' };

describe('runCli without a command', () => {
  const descriptors = {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  };
  let stderr = '';

  function setTerminal(isTTY: boolean): void {
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, 'isTTY', {
        value: isTTY,
        configurable: true,
      });
    }
  }

  beforeEach(() => {
    stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    loadTerminalEngine.mockReset();
    startTui.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, descriptor] of Object.entries(descriptors)) {
      const stream = name === 'stdin' ? process.stdin : process.stdout;
      if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
      else delete (stream as { isTTY?: boolean }).isTTY;
    }
  });

  it('refuses the interactive inbox without a terminal', async () => {
    setTerminal(false);
    expect(await runCli([], program)).toBe(2);
    expect(stderr).toContain('the interactive inbox needs a terminal');
    expect(loadTerminalEngine).not.toHaveBeenCalled();
  });

  it('explains when the terminal engine cannot load on this platform', async () => {
    setTerminal(true);
    loadTerminalEngine.mockRejectedValue(
      new Error(
        'Failed to load @rezi-ui/native binary. Tried: rezi_ui_native.linux-x64-gnu.node\n\nLast error:\nError: stack',
      ),
    );
    expect(await runCli([], program)).toBe(1);
    expect(stderr).toBe(
      `mail-debugger cli: the interactive inbox cannot start on ${process.platform}-${process.arch}: ` +
        'Failed to load @rezi-ui/native binary. Tried: rezi_ui_native.linux-x64-gnu.node\n' +
        'The commands (see --help) and the web inbox work without it.\n',
    );
    expect(startTui).not.toHaveBeenCalled();
  });

  it('starts the interactive inbox in a terminal', async () => {
    setTerminal(true);
    loadTerminalEngine.mockResolvedValue();
    startTui.mockResolvedValue();
    expect(await runCli(['--api-url', 'http://127.0.0.1:4000'], program)).toBe(
      0,
    );
    expect(startTui).toHaveBeenCalledWith(
      expect.anything(),
      'http://127.0.0.1:4000',
    );
    expect(stderr).toBe('');
  });
});
