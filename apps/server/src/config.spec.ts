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
    ]) {
      expect(help).toContain(option);
    }
    expect(help).toContain('MAIL_DEBUGGER_API_TOKEN');
    expect(help).toContain('(default: 127.0.0.1)');
  });
});
