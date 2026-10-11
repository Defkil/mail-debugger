import {
  DEFAULT_API_URL,
  DEFAULT_WAIT_TIMEOUT_MS,
  formatHelp,
  parseConfig,
  UsageError,
} from './parse-config.js';

describe('parseConfig', () => {
  it('starts the interactive inbox without a command', () => {
    expect(parseConfig([])).toEqual({ mode: 'tui', apiUrl: DEFAULT_API_URL });
    expect(parseConfig(['--api-url', 'http://host:4000/'])).toEqual({
      mode: 'tui',
      apiUrl: 'http://host:4000',
    });
  });

  it('uses the IPv4 loopback address by default', () => {
    expect(DEFAULT_API_URL).toBe('http://127.0.0.1:3000');
  });

  it.each([
    [['list'], { name: 'list' }],
    [['show', '42'], { name: 'show', id: 42 }],
    [['delete', '7'], { name: 'delete', id: 7 }],
    [['delete-all'], { name: 'delete-all' }],
    [['health'], { name: 'health' }],
    [['wait'], { name: 'wait', timeoutMs: DEFAULT_WAIT_TIMEOUT_MS }],
  ])('parses %j', (argv, command) => {
    expect(parseConfig(argv)).toEqual({
      mode: 'command',
      apiUrl: DEFAULT_API_URL,
      json: false,
      command,
    });
  });

  it('parses options in any order', () => {
    expect(
      parseConfig([
        '--json',
        'list',
        '--api-url',
        'http://myhost:4000',
        '--from',
        'alice@test.com',
        '--to=bob@test.com',
        '--subject',
        'hello',
        '--since',
        '2025-01-01',
        '--until',
        '2025-12-31',
        '--limit',
        '10',
        '--offset',
        '20',
      ]),
    ).toEqual({
      mode: 'command',
      apiUrl: 'http://myhost:4000',
      json: true,
      command: {
        name: 'list',
        filter: {
          from: 'alice@test.com',
          to: 'bob@test.com',
          subject: 'hello',
          since: '2025-01-01',
          until: '2025-12-31',
        },
        limit: 10,
        offset: 20,
      },
    });
  });

  it('parses the wait options', () => {
    expect(
      parseConfig([
        'wait',
        '--to',
        'alice@example.com',
        '--after-id',
        '0',
        '--mailbox-id',
        'abc',
        '--timeout',
        '120000',
      ]),
    ).toMatchObject({
      command: {
        name: 'wait',
        filter: { to: 'alice@example.com' },
        afterId: 0,
        mailboxId: 'abc',
        timeoutMs: 120_000,
      },
    });
  });

  it.each([['--help'], ['-h'], ['list', '--help']])(
    'returns help for %s',
    (...argv) => {
      expect(parseConfig(argv)).toEqual({ mode: 'help' });
    },
  );

  it.each([['--version'], ['-v']])('returns the version for %s', (flag) => {
    expect(parseConfig([flag])).toEqual({ mode: 'version' });
  });

  it.each([
    [['frobnicate'], /Unknown command "frobnicate"/],
    [['--cli', 'list'], /Unknown option '--cli'/],
    [['list', '--bogus'], /Unknown option '--bogus'/],
    [['list', '--from'], /argument missing/],
    [['list', '--limit', '0'], /--limit must be a whole number from 1 to 200/],
    [['list', '--limit', '1.5'], /--limit/],
    [['list', '--offset', '-1'], /ambiguous/],
    [['list', '--offset=-1'], /--offset must be a whole number/],
    [['list', '--json', '--json'], /--json was given more than once/],
    [['list', '--from', 'a', '--from', 'b'], /--from was given more than once/],
    [['list', 'extra'], /takes no arguments/],
    [['show'], /needs exactly one email id/],
    [['show', '1', '2'], /needs exactly one email id/],
    [['show', 'abc'], /email id must be a whole number/],
    [['delete', '0'], /email id must be a whole number/],
    [['show', '1', '--limit', '5'], /--limit does not apply to "show"/],
    [['health', '--timeout', '5'], /--timeout does not apply to "health"/],
    [['--json'], /--json needs a command/],
    [['wait', '--timeout', '3600001'], /--timeout must be a whole number/],
    [['list', '--api-url', 'localhost:3000'], /Invalid --api-url/],
    [['list', '--api-url', ''], /Invalid --api-url/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseConfig(argv)).toThrow(UsageError);
    expect(() => parseConfig(argv)).toThrow(message);
  });

  it('documents every command and the token variable', () => {
    const help = formatHelp('mail-debugger cli');
    expect(help).toContain('Usage: mail-debugger cli [options] [command]');
    for (const command of [
      'list',
      'show <id>',
      'delete <id>',
      'delete-all',
      'health',
      'wait',
    ]) {
      expect(help).toContain(`  ${command}`);
    }
    expect(help).toContain('MAIL_DEBUGGER_API_TOKEN');
  });
});
