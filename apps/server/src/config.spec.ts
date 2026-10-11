import path from 'node:path';
import {
  formatServerHelp,
  isLoopbackHost,
  parseServerArgs,
  UsageError,
  type ParseContext,
} from './config.js';
import type { ServerConfig } from './types.js';

const cwd = path.resolve('/work');

function context(
  env: Record<string, string> = {},
  files: Record<string, string> = {},
): ParseContext {
  return {
    env,
    cwd,
    readFile: (file) => {
      if (!Object.hasOwn(files, file)) throw new Error(`ENOENT: ${file}`);
      return files[file];
    },
  };
}

function run(argv: string[], ctx = context()): ServerConfig {
  const command = parseServerArgs(argv, ctx);
  if (command.kind !== 'run') throw new Error(`unexpected ${command.kind}`);
  return command.config;
}

function usageError(argv: string[], ctx = context()): string {
  try {
    parseServerArgs(argv, ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  throw new Error('expected a usage error');
}

describe('parseServerArgs', () => {
  it('defaults to loopback, the documented ports and in-memory storage', () => {
    expect(run([])).toEqual({
      host: '127.0.0.1',
      smtpPort: 2525,
      apiPort: 3000,
      tls: 'none',
      allowInsecureAuth: false,
      limits: {
        maxMessageBytes: 25 * 1024 * 1024,
        maxMessages: 1000,
        maxStorageBytes: 250 * 1024 * 1024,
      },
      maxSmtpClients: 20,
      httpAllowedHosts: [],
      httpAllowedOrigins: [],
    });
  });

  it('returns help and version without a configuration', () => {
    expect(parseServerArgs(['--help'], context())).toEqual({ kind: 'help' });
    expect(parseServerArgs(['-h'], context())).toEqual({ kind: 'help' });
    expect(parseServerArgs(['--version'], context())).toEqual({
      kind: 'version',
    });
  });

  it('parses ports, including 0 for a free port', () => {
    expect(run(['--smtp-port', '1025', '--api-port', '0'])).toMatchObject({
      smtpPort: 1025,
      apiPort: 0,
    });
    expect(run(['--smtp-port=65535']).smtpPort).toBe(65_535);
  });

  it.each(['abc', '1.5', '65536', '1e3', '0x10', 'Infinity', 'NaN', ''])(
    'rejects the port %j',
    (port) => {
      expect(usageError(['--smtp-port', port])).toMatch(/--smtp-port must be/);
    },
  );

  it('rejects a negative port', () => {
    expect(usageError(['--smtp-port', '-1'])).toMatch(/--smtp-port/);
    expect(usageError(['--smtp-port=-1'])).toMatch(/--smtp-port must be/);
  });

  it('rejects unknown options, positionals, missing values and repeats', () => {
    expect(usageError(['--cli'])).toMatch(/Unknown option '--cli'/);
    expect(usageError(['serve'])).toMatch(/positional/i);
    expect(usageError(['--smtp-port'])).toMatch(/argument missing/);
    expect(usageError(['--tls', 'none', '--tls', 'implicit'])).toBe(
      '--tls was given more than once',
    );
  });

  it('accepts the three TLS modes only', () => {
    expect(run(['--tls', 'starttls']).tls).toBe('starttls');
    expect(run(['--tls', 'implicit']).tls).toBe('implicit');
    expect(usageError(['--tls'])).toMatch(/argument missing/);
    expect(usageError(['--tls', 'ssl'])).toMatch(/--tls must be one of/);
  });

  it('requires certificate and key together and with TLS', () => {
    expect(
      run(['--tls', 'implicit', '--tls-cert', 'c.pem', '--tls-key', 'k.pem']),
    ).toMatchObject({ tlsCertFile: 'c.pem', tlsKeyFile: 'k.pem' });
    expect(usageError(['--tls', 'implicit', '--tls-cert', 'c.pem'])).toMatch(
      /must be given together/,
    );
    expect(usageError(['--tls-cert', 'c.pem', '--tls-key', 'k.pem'])).toMatch(
      /need --tls starttls or --tls implicit/,
    );
  });

  describe('credentials', () => {
    it('reads the password from the environment or a file', () => {
      expect(
        run(
          ['--auth-user', 'dev'],
          context({ MAIL_DEBUGGER_AUTH_PASSWORD: 's3cret' }),
        ).credentials,
      ).toEqual({ user: 'dev', password: 's3cret' });
      expect(
        run(
          ['--auth-user', 'dev', '--auth-password-file', 'pw.txt'],
          context({}, { 'pw.txt': 'from-file\n' }),
        ).credentials,
      ).toEqual({ user: 'dev', password: 'from-file' });
    });

    it('rejects incomplete or doubled password sources', () => {
      expect(usageError(['--auth-user', 'dev'])).toMatch(/needs a password/);
      expect(
        usageError(
          ['--auth-password-file', 'pw.txt'],
          context({}, { 'pw.txt': 'x' }),
        ),
      ).toBe('--auth-password-file needs --auth-user');
      expect(
        usageError(
          ['--auth-user', 'dev', '--auth-password-file', 'pw.txt'],
          context({ MAIL_DEBUGGER_AUTH_PASSWORD: 'x' }, { 'pw.txt': 'y' }),
        ),
      ).toMatch(/either MAIL_DEBUGGER_AUTH_PASSWORD or --auth-password-file/);
      expect(
        usageError([
          '--auth-user',
          'dev',
          '--auth-password-file',
          'missing.txt',
        ]),
      ).toMatch(/Cannot read --auth-password-file/);
    });

    it('never puts the password into an error message', () => {
      const message = usageError(
        ['--auth-user', 'dev', '--auth-password-file', 'pw.txt'],
        context(
          { MAIL_DEBUGGER_AUTH_PASSWORD: 'hunter2' },
          { 'pw.txt': 'hunter3' },
        ),
      );
      expect(message).not.toMatch(/hunter/);
    });
  });

  describe('storage', () => {
    it('persists into the working directory or the data directory', () => {
      expect(run(['--persist']).dataDir).toBe(cwd);
      expect(run(['--data-dir', 'mail']).dataDir).toBe(path.join(cwd, 'mail'));
      expect(run(['--persist', '--data-dir', 'mail']).dataDir).toBe(
        path.join(cwd, 'mail'),
      );
      expect(run([])).not.toHaveProperty('dataDir');
    });

    it('parses and checks the limits', () => {
      expect(
        run([
          '--max-messages',
          '5',
          '--max-message-bytes',
          '100',
          '--max-storage-bytes',
          '1000',
        ]).limits,
      ).toEqual({
        maxMessages: 5,
        maxMessageBytes: 100,
        maxStorageBytes: 1000,
      });
      expect(usageError(['--max-messages', '0'])).toMatch(
        /positive whole number/,
      );
      expect(usageError(['--max-messages', '2.5'])).toMatch(
        /positive whole number/,
      );
      expect(
        usageError([
          '--max-message-bytes',
          '2000',
          '--max-storage-bytes',
          '1000',
        ]),
      ).toMatch(/must not be larger/);
    });
  });

  describe('exposure beyond loopback', () => {
    const secured = [
      '--host',
      '0.0.0.0',
      '--tls',
      'starttls',
      '--auth-user',
      'dev',
    ];
    const securedEnv = {
      MAIL_DEBUGGER_AUTH_PASSWORD: 'pw',
      MAIL_DEBUGGER_API_TOKEN: 'token-123',
    };

    it('accepts a protected remote listener', () => {
      expect(run(secured, context(securedEnv))).toMatchObject({
        host: '0.0.0.0',
        apiToken: 'token-123',
      });
    });

    it('lists every missing protection', () => {
      const message = usageError(['--host', '0.0.0.0']);
      expect(message).toMatch(/MAIL_DEBUGGER_API_TOKEN/);
      expect(message).toMatch(/--tls starttls or --tls implicit/);
      expect(message).toMatch(/--auth-user/);
    });

    it('does not let insecure authentication bypass the rule', () => {
      expect(
        usageError([...secured, '--allow-insecure-auth'], context(securedEnv)),
      ).toMatch(/--allow-insecure-auth/);
    });

    it('allows insecure authentication on loopback', () => {
      expect(run(['--allow-insecure-auth']).allowInsecureAuth).toBe(true);
    });

    it('rejects malformed hosts', () => {
      expect(usageError(['--host', 'not a host'])).toMatch(/--host must be/);
      expect(run(['--host', '[::1]']).host).toBe('::1');
      expect(run(['--host', 'localhost']).host).toBe('localhost');
    });
  });

  it('validates allowed hosts and origins', () => {
    expect(
      run([
        '--http-allowed-host',
        'Mail.Example:8080',
        '--http-allowed-host',
        'proxy.local',
        '--http-allowed-origin',
        'https://mail.example',
      ]),
    ).toMatchObject({
      httpAllowedHosts: ['mail.example:8080', 'proxy.local'],
      httpAllowedOrigins: ['https://mail.example'],
    });
    expect(usageError(['--http-allowed-host', 'http://x'])).toMatch(
      /host or host:port/,
    );
    expect(usageError(['--http-allowed-origin', 'https://x/path'])).toMatch(
      /without a path/,
    );
    expect(usageError(['--http-allowed-origin', 'ftp://x'])).toMatch(/scheme/);
  });

  describe('IMAP', () => {
    it('is off unless --imap is given', () => {
      expect(run([]).imap).toBeUndefined();
      expect(usageError(['--imap-port', '1143'])).toBe(
        '--imap-port needs --imap',
      );
    });

    it('uses 1143, 1993 with implicit TLS, or the given port', () => {
      expect(run(['--imap']).imap).toEqual({ port: 1143 });
      expect(run(['--imap', '--tls', 'starttls']).imap).toEqual({
        port: 1143,
      });
      expect(run(['--imap', '--tls', 'implicit']).imap).toEqual({
        port: 1993,
      });
      expect(run(['--imap', '--imap-port', '0']).imap).toEqual({ port: 0 });
      expect(usageError(['--imap', '--imap-port', '70000'])).toMatch(
        /--imap-port must be a whole number/,
      );
    });

    it('refuses configured credentials over plaintext unless allowed', () => {
      const env = context({ MAIL_DEBUGGER_AUTH_PASSWORD: 'pw' });
      expect(usageError(['--imap', '--auth-user', 'dev'], env)).toMatch(
        /plain text.*--allow-insecure-auth/,
      );
      expect(
        run(['--imap', '--auth-user', 'dev', '--allow-insecure-auth'], env)
          .imap,
      ).toEqual({ port: 1143 });
      expect(
        run(['--imap', '--auth-user', 'dev', '--tls', 'starttls'], env).imap,
      ).toEqual({ port: 1143 });
    });
  });

  describe('MCP', () => {
    it('is off unless --mcp is given', () => {
      expect(run([]).mcp).toBeUndefined();
      expect(usageError(['--mcp-allow-mutations'])).toBe(
        '--mcp-allow-mutations needs --mcp',
      );
    });

    it('offers read-only tools unless mutations are allowed', () => {
      expect(run(['--mcp']).mcp).toEqual({ allowMutations: false });
      expect(run(['--mcp', '--mcp-allow-mutations']).mcp).toEqual({
        allowMutations: true,
      });
    });

    it('reads the token from MAIL_DEBUGGER_MCP_TOKEN', () => {
      const env = context({ MAIL_DEBUGGER_MCP_TOKEN: 'mcp-secret' });
      expect(run(['--mcp'], env).mcp).toEqual({
        allowMutations: false,
        token: 'mcp-secret',
      });
      // Without --mcp the variable belongs to the stdio bridge.
      expect(run([], env).mcp).toBeUndefined();
      expect(
        usageError(['--mcp'], context({ MAIL_DEBUGGER_MCP_TOKEN: 'a b' })),
      ).toMatch(/MAIL_DEBUGGER_MCP_TOKEN must be/);
    });

    it('requires the token beyond loopback', () => {
      const env = {
        MAIL_DEBUGGER_AUTH_PASSWORD: 'pw',
        MAIL_DEBUGGER_API_TOKEN: 'api',
      };
      const remote = [
        '--host',
        '0.0.0.0',
        '--tls',
        'starttls',
        '--auth-user',
        'dev',
        '--mcp',
      ];
      expect(usageError(remote, context(env))).toMatch(
        /MAIL_DEBUGGER_MCP_TOKEN to protect MCP/,
      );
      expect(
        run(remote, context({ ...env, MAIL_DEBUGGER_MCP_TOKEN: 'mcp' })).mcp,
      ).toEqual({ allowMutations: false, token: 'mcp' });
    });
  });

  it('rejects an empty or whitespace API token', () => {
    expect(usageError([], context({ MAIL_DEBUGGER_API_TOKEN: '' }))).toMatch(
      /MAIL_DEBUGGER_API_TOKEN/,
    );
    expect(usageError([], context({ MAIL_DEBUGGER_API_TOKEN: 'a b' }))).toMatch(
      /without whitespace/,
    );
  });
});

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.5.6.7', true],
    ['::1', true],
    ['localhost', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['mail.example', false],
  ])('%s -> %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe('formatServerHelp', () => {
  it('documents every option and the environment, without secrets', () => {
    const help = formatServerHelp();
    for (const option of [
      '--host',
      '--smtp-port',
      '--api-port',
      '--tls <none|starttls|implicit>',
      '--data-dir',
      '--max-messages',
      '--http-allowed-origin',
      '--imap',
      '--imap-port <port>',
      '--mcp',
      '--mcp-allow-mutations',
    ]) {
      expect(help).toContain(option);
    }
    expect(help).toContain('MAIL_DEBUGGER_API_TOKEN');
    expect(help).toContain('MAIL_DEBUGGER_MCP_TOKEN');
    expect(help).toContain('(default: 127.0.0.1)');
  });

  it('describes the slim distribution without a web inbox', () => {
    const help = formatServerHelp('mail-debugger-api', { withWeb: false });
    expect(help).toMatch(/^Usage: mail-debugger-api \[options\]$/m);
    expect(help).toContain('No web inbox.');
    expect(help).toContain('HTTP port of the REST API and API docs');
    expect(help).not.toContain('shows it in a');
    expect(help).not.toContain('Commands:');
  });

  it('lists the commands of the main binary', () => {
    const help = formatServerHelp('mail-debugger', { withCommands: true });
    expect(help).toContain('mail-debugger mcp [--url <url>]');
    expect(help).toMatch(/^ {2}mcp {4}Connect an MCP client/m);
  });
});
describe('UsageError diagnostics', () => {
  it('replaces terminal controls in untrusted argument and file error text', () => {
    const error = new UsageError(
      'Invalid argument \u{1B}]52;c;payload\u{7}\rforged\u{9B}31m',
    );
    expect(error.message).toBe(
      'Invalid argument �]52;c;payload�\u{FFFD}forged�31m',
    );
  });
});
