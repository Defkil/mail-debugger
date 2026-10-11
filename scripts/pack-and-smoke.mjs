#!/usr/bin/env node
// Packs the three distributions, checks what each tarball contains,
// installs every tarball on its own into an empty project outside the
// workspace with production dependencies only, and runs what users run:
// the installed commands, the client import from JavaScript and
// TypeScript, an SMTP message read back over REST, the client, both
// terminal clients, IMAP, MCP over HTTP and the stdio bridge, the web
// inbox assets and the native engine of the interactive inbox.
//
// Usage: node scripts/pack-and-smoke.mjs [--pack-only] [--tarballs <dir>] [--keep]
//   --pack-only       pack and inspect the tarballs, then stop
//   --tarballs <dir>  test the tarballs in <dir> instead of packing new ones
//   --keep            keep the temporary directory for a closer look
// Environment:
//   MAIL_DEBUGGER_PACK_DIR  pack into this new or empty directory and keep
//                           the tarballs there; the release workflow
//                           publishes exactly these files
//
// Run it after `pnpm build` (`pnpm smoke` builds first). Every process and
// file it creates is removed again, also when a check fails or the run is
// interrupted. Exit code 0 means that every check passed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';

const root = path.dirname(import.meta.dirname);
const helpers = path.join(import.meta.dirname, 'smoke');
const isWindows = process.platform === 'win32';
const MiB = 1024 * 1024;

/**
 * The distributions and what their tarballs may contain (paths below
 * `package/`). Any other file fails the check, so a new file is a
 * deliberate change here. The size limits catch unexplained growth; raise
 * one in the commit that explains the growth.
 */
const DISTRIBUTIONS = [
  {
    name: 'mail-debugger',
    dir: '.',
    bin: 'mail-debugger',
    maxUnpackedBytes: 3 * MiB,
    allowed: [
      /^(?:package\.json|README\.md|LICENSE|CHANGELOG\.md)$/,
      /^apps\/server\/dist\/main\.mjs$/,
      /^apps\/server\/dist\/[a-z-]+-[A-Z\d]{8}\.mjs$/,
      /^apps\/server\/dist\/web\/(?:index\.html|favicon\.svg|_app\/version\.json)$/,
      /^apps\/server\/dist\/web\/_app\/immutable\/(?:assets|chunks|entry|nodes)\/[\w.-]+\.(?:js|css|woff2?|svg|png)$/,
      /^libs\/client\/dist\/(?:lib\/)?[\w-]+\.(?:js|d\.ts)$/,
    ],
    required: [
      'package.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
      'apps/server/dist/main.mjs',
      'apps/server/dist/web/index.html',
      'apps/server/dist/web/_app/version.json',
      'libs/client/dist/index.js',
      'libs/client/dist/index.d.ts',
    ],
  },
  {
    name: 'mail-debugger-api',
    dir: 'packages/api',
    bin: 'mail-debugger-api',
    maxUnpackedBytes: 7 * MiB,
    allowed: [/^(?:package\.json|README\.md|LICENSE)$/, /^dist\/main\.mjs$/],
    required: ['package.json', 'README.md', 'LICENSE', 'dist/main.mjs'],
  },
  {
    name: 'mail-debugger-cli',
    dir: 'packages/cli',
    bin: 'mail-debugger-cli',
    maxUnpackedBytes: 2.5 * MiB,
    allowed: [
      /^(?:package\.json|README\.md|LICENSE)$/,
      /^dist\/main\.mjs$/,
      /^dist\/[a-z-]+-[A-Z\d]{8}\.mjs$/,
    ],
    required: ['package.json', 'README.md', 'LICENSE', 'dist/main.mjs'],
  },
];

/** Sorts strings by UTF-16 code units, like Array#sort without a comparator. */
const byCodeUnit = (a, b) => (a < b ? -1 : Number(a > b));

/** The runtime exports of mail-debugger/client; a change is an API change. */
const CLIENT_EXPORTS = [
  'DEFAULT_TIMEOUT_MS',
  'DEFAULT_WAIT_MS',
  'EMAIL_FILTER_KEYS',
  'MAX_WAIT_MS',
  'MailDebuggerApiError',
  'MailDebuggerNetworkError',
  'MailDebuggerTimeoutError',
  'createApiClient',
  'dispositionFilename',
  'emailFilterToEntries',
  'getErrorMessage',
  'normalizeBaseUrl',
  'pickEmailFilter',
];

const READ_TOOLS = [
  'get_email',
  'get_email_attachment',
  'list_email_attachments',
  'list_emails',
  'search_emails',
  'wait_for_email',
];

const DEV_LOGIN = { user: 'mail-debugger', pass: 'mail-debugger' };
const ATTACHMENT = Buffer.from([0, 1, 2, 255]);
const MESSAGE_ID = '<pack-and-smoke@example.test>';
const SUBJECT = 'Grüße aus dem Paket';
const ENVELOPE = {
  from: 'sender@example.test',
  to: ['recipient@example.test', 'hidden@example.test'],
};

class SmokeError extends Error {
  constructor(message, details = '') {
    super(details ? `${message}\n${details.trimEnd()}` : message);
    this.name = 'SmokeError';
  }
}

// ---------------------------------------------------------------------------
// Bookkeeping: every child process and the work directory are removed on
// every exit path.

const children = new Set();
let workDir;
let keepWorkDir = false;

function cleanUp() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  children.clear();
  if (workDir && !keepWorkDir) {
    fs.rmSync(workDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
}

process.on('exit', cleanUp);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\nInterrupted by ${signal}; cleaning up.`);
    process.exit(130);
  });
}

function ok(message) {
  console.log(`ok    ${message}`);
}

function expectEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new SmokeError(`${what}: expected ${b}, got ${a}`);
}

function expectTrue(condition, what, details = '') {
  if (!condition) throw new SmokeError(what, details);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatBytes(bytes) {
  return bytes >= MiB
    ? `${(bytes / MiB).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** The environment without the caller's mail-debugger tokens and npm settings. */
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:MAIL_DEBUGGER_|npm_)/i.test(key),
    ),
  );
  return { ...env, ...extra };
}

function quote(argument) {
  if (/^[\w@%+=:,./\\-]+$/.test(argument)) return argument;
  return isWindows
    ? `"${argument.replaceAll('"', '""')}"`
    : `'${argument.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Runs a command to completion and resolves to its exit code and output.
 * With `shell`, the command line goes through the system shell, which
 * Windows needs for npm and for the .cmd shims of installed commands.
 */
function exec(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd ?? root,
    env: options.env ?? cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const child = options.shell
    ? spawn([command, ...args].map((part) => quote(part)).join(' '), {
        ...spawnOptions,
        shell: true,
      })
    : spawn(command, args, spawnOptions);
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new SmokeError(
          `Timed out after ${timeoutMs} ms: ${command} ${args.join(' ')}`,
          stdout + stderr,
        ),
      );
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      children.delete(child);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
}

async function npm(args, cwd) {
  const result = await exec('npm', args, {
    cwd,
    shell: true,
    timeoutMs: 600_000,
  });
  if (result.code !== 0) {
    throw new SmokeError(
      `npm ${args.join(' ')} failed with code ${result.code}`,
      result.stdout + result.stderr,
    );
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Packing and the tarball contract.

function workspaceVersion() {
  const versions = DISTRIBUTIONS.map(
    (distribution) =>
      readJson(path.join(root, distribution.dir, 'package.json')).version,
  );
  expectTrue(
    versions.every((version) => version === versions[0]),
    `The three distributions must share one version, found ${versions.join(', ')}`,
  );
  return versions[0];
}

function assertBuilt() {
  const outputs = [
    'apps/server/dist/main.mjs',
    'apps/server/dist/web/index.html',
    'libs/client/dist/index.js',
    'packages/api/dist/main.mjs',
    'packages/cli/dist/main.mjs',
  ];
  const missing = outputs.filter(
    (file) => !fs.existsSync(path.join(root, file)),
  );
  expectTrue(
    missing.length === 0,
    `Build output is missing (${missing.join(', ')}); run pnpm build first`,
  );
}

async function pack(destination) {
  const tarballs = new Map();
  for (const distribution of DISTRIBUTIONS) {
    // Scripts stay off: the build is done, and prepack would build again
    // between the checks and the tarball.
    const output = await npm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
      path.join(root, distribution.dir),
    );
    const [manifest] = JSON.parse(output);
    expectEqual(manifest.name, distribution.name, 'Packed package name');
    const file = path.join(destination, manifest.filename);
    const digest = createHash('sha512')
      .update(fs.readFileSync(file))
      .digest('base64');
    expectEqual(
      `sha512-${digest}`,
      manifest.integrity,
      `${manifest.filename} integrity`,
    );
    tarballs.set(distribution.name, file);
  }
  return tarballs;
}

function findTarballs(dir, version) {
  const tarballs = new Map();
  for (const distribution of DISTRIBUTIONS) {
    const file = path.join(dir, `${distribution.name}-${version}.tgz`);
    expectTrue(fs.existsSync(file), `Missing tarball ${file}`);
    tarballs.set(distribution.name, file);
  }
  return tarballs;
}

/** The regular files of a gzipped tar archive as npm pack writes it. */
function readTarball(file) {
  const archive = zlib.gunzipSync(fs.readFileSync(file));
  const entries = [];
  let offset = 0;
  let extendedPath;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0[\s\S]*$/, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const data = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      extendedPath = /(?:^|\n)\d+ path=([^\n]*)/.exec(
        data.toString('utf8'),
      )?.[1];
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(345, 155);
    const name =
      extendedPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    extendedPath = undefined;
    if (type !== '0') continue;
    entries.push({
      path: name.replace(/^package\//, ''),
      mode: Number.parseInt(field(100, 8).trim() || '0', 8),
      data,
    });
  }
  return entries;
}

function inspectTarball(distribution, file, version) {
  const entries = readTarball(file);
  const files = new Map(entries.map((entry) => [entry.path, entry]));
  const names = entries.map((entry) => entry.path);
  const unexpected = names.filter((name) =>
    distribution.allowed.every((rule) => !rule.test(name)),
  );
  expectTrue(
    unexpected.length === 0,
    `${distribution.name}: unexpected files in the tarball`,
    unexpected.join('\n'),
  );
  const missing = distribution.required.filter((name) => !files.has(name));
  expectTrue(
    missing.length === 0,
    `${distribution.name}: missing files in the tarball`,
    missing.join('\n'),
  );

  const manifest = JSON.parse(files.get('package.json').data.toString('utf8'));
  expectEqual(manifest.version, version, `${distribution.name} version`);
  expectEqual(manifest.license, 'MIT', `${distribution.name} license`);
  expectEqual(
    manifest.engines?.node,
    '>=22.17.0',
    `${distribution.name} Node engine`,
  );
  expectEqual(
    manifest.repository?.url,
    'git+https://github.com/Defkil/mail-debugger.git',
    `${distribution.name} repository`,
  );
  expectEqual(
    manifest.publishConfig,
    { access: 'public', provenance: true },
    `${distribution.name} publishConfig`,
  );
  const ranges = Object.entries(manifest.dependencies ?? {}).filter(
    ([, range]) => !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(range),
  );
  expectTrue(
    ranges.length === 0,
    `${distribution.name}: dependencies must be exact versions`,
    ranges.map(([name, range]) => `${name}@${range}`).join('\n'),
  );

  const binTarget = manifest.bin?.[distribution.bin]?.replace(/^\.\//, '');
  const bin = binTarget && files.get(binTarget);
  expectTrue(
    bin,
    `${distribution.name}: bin ${distribution.bin} is not packed`,
  );
  expectTrue(
    bin.data.subarray(0, 20).toString('utf8') === '#!/usr/bin/env node\n',
    `${distribution.name}: ${binTarget} lacks the node shebang`,
  );
  // npm packs the bin with the mode of the built file (0644 from esbuild)
  // and makes it executable when it installs the package; checkCommandLines
  // and startServer run the installed command directly on Linux and macOS.
  expectTrue(
    files
      .get('LICENSE')
      .data.equals(fs.readFileSync(path.join(root, 'LICENSE'))),
    `${distribution.name}: LICENSE differs from the repository license`,
  );

  if (distribution.name === 'mail-debugger') {
    inspectMainPackage(files, manifest);
  } else {
    expectTrue(
      names.every((name) => !name.includes('/web/')),
      `${distribution.name} must not ship the web inbox`,
    );
  }

  const unpacked = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  expectTrue(
    unpacked <= distribution.maxUnpackedBytes,
    `${distribution.name}: ${unpacked} unpacked bytes exceed the limit of ${distribution.maxUnpackedBytes}; explain the growth and raise the limit`,
  );
  const packed = fs.statSync(file).size;
  ok(
    `${distribution.name}: tarball holds ${entries.length} expected files, ${formatBytes(unpacked)} unpacked, ${formatBytes(packed)} packed`,
  );
  return { files: entries.length, unpacked, packed };
}

function inspectMainPackage(files, manifest) {
  expectEqual(
    manifest.exports,
    {
      './client': {
        types: './libs/client/dist/index.d.ts',
        import: './libs/client/dist/index.js',
        default: './libs/client/dist/index.js',
      },
      './package.json': './package.json',
    },
    'mail-debugger exports',
  );
  expectTrue(
    manifest.types === undefined && manifest.main === undefined,
    'mail-debugger must not declare a root entry point',
  );
  // The declarations stand alone: only relative imports of .js paths.
  for (const [name, entry] of files) {
    if (!name.endsWith('.d.ts')) continue;
    const text = entry.data.toString('utf8');
    const specifiers = Array.from(
      text.matchAll(/from\s+['"]([^'"]+)['"]/g),
      (match) => match[1],
    );
    const external = specifiers.filter(
      (specifier) => !/^\.\.?\/.*\.js$/.test(specifier),
    );
    expectTrue(
      external.length === 0 && !text.includes('@mail-debugger/'),
      `${name} must import only relative .js paths, found ${external.join(', ')}`,
    );
  }
  // Every asset the web inbox references is packed.
  const html = files
    .get('apps/server/dist/web/index.html')
    .data.toString('utf8');
  const assets = webAssets(html);
  expectTrue(assets.length > 0, 'The web inbox references no assets');
  const unpacked = assets.filter(
    (asset) => !files.has(`apps/server/dist/web${asset}`),
  );
  expectTrue(
    unpacked.length === 0,
    'The web inbox references files that are not packed',
    unpacked.join('\n'),
  );
}

function webAssets(html) {
  const references = Array.from(
    html.matchAll(/(?:href|src)="(\/[^"]+)"|import\("(\/[^"]+)"\)/g),
    (match) => match[1] ?? match[2],
  );
  return [...new Set(references)];
}

// ---------------------------------------------------------------------------
// Each tarball installed on its own, so that no package can borrow a
// dependency of another.

async function install(tarball, name) {
  const consumer = path.join(workDir, `consumer-${name}`);
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({ name: `smoke-${name}`, private: true, type: 'module' }, null, 2)}\n`,
  );
  // Lifecycle scripts stay off; checkTree() proves that no installed
  // package needs one.
  await npm(
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--loglevel=error',
      tarball,
    ],
    consumer,
  );
  return consumer;
}

function packageDirs(modules) {
  const dirs = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        visit(full);
        continue;
      }
      if (fs.existsSync(path.join(full, 'package.json'))) dirs.push(full);
      const nested = path.join(full, 'node_modules');
      if (fs.existsSync(nested)) visit(nested);
    }
  };
  visit(modules);
  return dirs;
}

function directorySize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** Packages, size and install scripts of the production dependency tree. */
function checkTree(consumer, name) {
  const modules = path.join(consumer, 'node_modules');
  const packages = packageDirs(modules);
  const withScripts = packages
    .filter((dir) => {
      const { scripts = {} } = readJson(path.join(dir, 'package.json'));
      return (
        scripts.preinstall ||
        scripts.install ||
        scripts.postinstall ||
        fs.existsSync(path.join(dir, 'binding.gyp'))
      );
    })
    .map((dir) => path.relative(modules, dir));
  expectTrue(
    withScripts.length === 0,
    `${name}: these dependencies have install scripts, which --ignore-scripts skipped; review them`,
    withScripts.join('\n'),
  );
  expectTrue(
    !fs.existsSync(path.join(modules, '@mail-debugger')),
    `${name}: a workspace package was installed`,
  );
  const bytes = directorySize(modules);
  ok(
    `${name}: installed alone with ${packages.length} packages, ${formatBytes(bytes)} in node_modules, no install scripts`,
  );
  return { packages: packages.length, bytes };
}

function shim(consumer, bin) {
  const file = path.join(consumer, 'node_modules', '.bin', bin);
  return isWindows ? `${file}.cmd` : file;
}

/** Runs an installed command the way a shell would. */
function runInstalled(consumer, bin, args) {
  return exec(shim(consumer, bin), args, { cwd: consumer, shell: isWindows });
}

/** Copies a helper script into a consumer project and runs it there. */
function runHelper(consumer, helper, args = []) {
  fs.copyFileSync(path.join(helpers, helper), path.join(consumer, helper));
  return exec(process.execPath, [helper, ...args], {
    cwd: consumer,
    timeoutMs: 30_000,
  });
}

function installedBin(consumer, name, bin) {
  const dir = path.join(consumer, 'node_modules', name);
  return path.join(dir, readJson(path.join(dir, 'package.json')).bin[bin]);
}

async function expectRun(consumer, bin, args, expected) {
  const result = await runInstalled(consumer, bin, args);
  const label = [bin, ...args].join(' ');
  const output = result.stdout + result.stderr;
  expectEqual(result.code, expected.code ?? 0, `Exit code of ${label}`);
  if (expected.stdout) {
    expectTrue(expected.stdout.test(result.stdout), `${label} printed`, output);
  }
  if (expected.stderr) {
    expectTrue(expected.stderr.test(result.stderr), `${label} printed`, output);
  }
}

async function checkCommandLines(consumers, version) {
  const full = consumers.get('mail-debugger');
  const api = consumers.get('mail-debugger-api');
  const cli = consumers.get('mail-debugger-cli');
  const exact = new RegExp(`^${version.replaceAll('.', String.raw`\.`)}\r?\n$`);
  await expectRun(full, 'mail-debugger', ['--version'], { stdout: exact });
  await expectRun(full, 'mail-debugger', ['--help'], {
    stdout: /Usage: mail-debugger \[serve\] \[options\]/,
  });
  await expectRun(full, 'mail-debugger', ['cli', '--version'], {
    stdout: exact,
  });
  await expectRun(full, 'mail-debugger', ['mcp', '--help'], {
    stdout: /Usage: mail-debugger mcp/,
  });
  await expectRun(full, 'mail-debugger', ['bogus'], {
    code: 2,
    stderr: /Unknown command "bogus"/,
  });
  await expectRun(api, 'mail-debugger-api', ['--version'], { stdout: exact });
  await expectRun(api, 'mail-debugger-api', ['--help'], {
    stdout: /Usage: mail-debugger-api \[options\]/,
  });
  await expectRun(api, 'mail-debugger-api', ['--bogus'], { code: 2 });
  await expectRun(cli, 'mail-debugger-cli', ['--version'], { stdout: exact });
  await expectRun(cli, 'mail-debugger-cli', ['--help'], {
    stdout: /Usage: mail-debugger-cli \[options\] \[command\]/,
  });
  await expectRun(cli, 'mail-debugger-cli', ['bogus'], { code: 2 });
  await expectRun(cli, 'mail-debugger-cli', [], {
    code: 2,
    stderr: /needs a terminal/,
  });
  await expectRun(
    cli,
    'mail-debugger-cli',
    ['--api-url', 'http://127.0.0.1:9', 'list'],
    { code: 1 },
  );
  if (!isWindows) {
    const installed = [
      [full, 'mail-debugger'],
      [api, 'mail-debugger-api'],
      [cli, 'mail-debugger-cli'],
    ];
    for (const [consumer, bin] of installed) {
      fs.accessSync(shim(consumer, bin), fs.constants.X_OK);
    }
  }
  ok('installed commands: --version, --help, usage errors and exit codes');
}

// ---------------------------------------------------------------------------
// The client from JavaScript and TypeScript, and the inbox engine.

async function checkClientImport(consumer) {
  const result = await runHelper(consumer, 'client-import.mjs');
  expectEqual(
    [result.code, result.stderr],
    [0, ''],
    'Exit code and errors of the client import',
  );
  const report = JSON.parse(result.stdout);
  expectEqual(
    report.exports.toSorted(byCodeUnit),
    CLIENT_EXPORTS,
    'Exports of mail-debugger/client',
  );
  expectEqual(report.root, 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'Root import');
  expectEqual(report.resources, [], 'Handles opened by importing the client');
  ok('mail-debugger/client: exports, no side effects, no root entry point');
}

async function checkClientTypes(consumer) {
  fs.copyFileSync(
    path.join(helpers, 'client-types.ts'),
    path.join(consumer, 'client-types.ts'),
  );
  const common = {
    target: 'es2022',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
  };
  const configs = {
    'tsconfig.nodenext.json': {
      ...common,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      lib: ['es2022'],
      types: ['node'],
      typeRoots: [path.join(root, 'node_modules', '@types')],
    },
    'tsconfig.bundler.json': {
      ...common,
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['es2022', 'dom'],
      types: [],
    },
  };
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  for (const [file, compilerOptions] of Object.entries(configs)) {
    fs.writeFileSync(
      path.join(consumer, file),
      JSON.stringify({ compilerOptions, files: ['client-types.ts'] }),
    );
    const result = await exec(process.execPath, [tsc, '-p', file], {
      cwd: consumer,
      timeoutMs: 120_000,
    });
    expectEqual(result.code, 0, `tsc -p ${file}: ${result.stdout}`);
  }
  ok('mail-debugger/client: TypeScript consumers with NodeNext and Bundler');
}

/**
 * Imports the chunk of the interactive inbox and loads the native engine
 * from the installed package, which needs no terminal.
 */
async function checkInboxEngine(consumer, name, bin) {
  const distDir = path.dirname(installedBin(consumer, name, bin));
  const chunk = fs
    .readdirSync(distDir)
    .filter((file) => file.endsWith('.mjs'))
    .find((file) =>
      fs
        .readFileSync(path.join(distDir, file), 'utf8')
        .includes('"@rezi-ui/native"'),
    );
  expectTrue(chunk, `${name}: no chunk loads @rezi-ui/native`);
  const result = await runHelper(consumer, 'inbox-engine.mjs', [
    pathToFileURL(path.join(distDir, chunk)).href,
  ]);
  expectEqual(
    result.code,
    0,
    `${name}: loading the inbox engine: ${result.stderr}`,
  );
  const exports = JSON.parse(result.stdout);
  expectTrue(
    exports.includes('startTui') && exports.includes('loadTerminalEngine'),
    `${name}: the inbox chunk exports ${exports.join(', ')}`,
  );
  ok(
    `${name}: interactive inbox chunk and native engine load on ${process.platform}-${process.arch}`,
  );
}

// ---------------------------------------------------------------------------
// Servers started from the installed packages.

function multipartMessage() {
  const lines = [
    'From: =?UTF-8?Q?J=C3=BCrgen_Sender?= <sender@example.test>',
    'To: Recipient <recipient@example.test>',
    `Subject: =?UTF-8?B?${Buffer.from(SUBJECT).toString('base64')}?=`,
    `Message-ID: ${MESSAGE_ID}`,
    'Date: Sun, 11 Oct 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="smoke-boundary"',
    '',
    '--smoke-boundary',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Gr=C3=BC=C3=9Fe from the packed tarball.',
    '--smoke-boundary',
    'Content-Type: application/octet-stream; name="bytes.bin"',
    'Content-Disposition: attachment; filename="bytes.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    ATTACHMENT.toString('base64'),
    '--smoke-boundary--',
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * Starts an installed server on free ports: on Linux and macOS through the
 * installed command itself (shebang and executable bit) and stopped with
 * SIGTERM; on Windows with node and an IPC channel, because a signal from
 * the parent would end the server without its shutdown.
 */
async function startServer(consumer, name, bin, args) {
  const fullArgs = [...args, '--smtp-port', '0', '--api-port', '0'];
  if (args.includes('--imap')) fullArgs.push('--imap-port', '0');
  const options = {
    cwd: workDir,
    env: cleanEnv({ NODE_ENV: 'production', LOG_LEVEL: 'info' }),
  };
  const child = isWindows
    ? spawn(
        process.execPath,
        [installedBin(consumer, name, bin), ...fullArgs],
        {
          ...options,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      )
    : spawn(shim(consumer, bin), fullArgs, {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  children.add(child);
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) =>
    child.once('exit', (code) => resolve(code)),
  );

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SmokeError(`${bin} did not start in time`, output)),
      30_000,
    );
    const check = () => {
      const lines = output.split('\n').slice(0, -1);
      const line = lines.find((text) =>
        text.includes('mail-debugger is ready'),
      );
      if (!line) return;
      clearTimeout(timer);
      child.stdout.off('data', check);
      resolve(JSON.parse(line));
    };
    child.stdout.on('data', check);
    void exited.then((code) => {
      clearTimeout(timer);
      reject(
        new SmokeError(
          `${bin} exited with ${code} before it was ready`,
          output,
        ),
      );
    });
  });

  return {
    smtpPort: ready.smtpPort,
    imapPort: ready.imapPort,
    baseUrl: `http://127.0.0.1:${ready.apiPort}`,
    output: () => output,
    async stop() {
      if (child.connected) child.send('shutdown');
      else child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const code = await exited;
      clearTimeout(timer);
      children.delete(child);
      expectEqual(code, 0, `Exit code of ${bin} after a graceful stop`);
      ok(`${name}: stops gracefully with exit code 0`);
    },
  };
}

async function sendMessage(port, raw) {
  const transport = createTransport({
    host: '127.0.0.1',
    port,
    secure: false,
    ignoreTLS: true,
  });
  try {
    await transport.sendMail({ envelope: ENVELOPE, raw });
  } finally {
    transport.close();
  }
}

async function get(url, as = 'json') {
  const response = await fetch(url);
  const body =
    as === 'json'
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
  expectTrue(response.ok, `GET ${url} answered ${response.status}`);
  return body;
}

/** Checks the stored message over REST and resolves to its id. */
async function checkRest(server, raw, version, name) {
  const health = await get(`${server.baseUrl}/api/health`);
  expectEqual(
    [health.version, health.imapPort, health.mcp],
    [version, server.imapPort, true],
    `${name} health`,
  );
  const list = await get(`${server.baseUrl}/api/emails`);
  expectEqual(list.total, 1, `${name} stored emails`);
  const id = list.data[0].id;
  const { data: email } = await get(`${server.baseUrl}/api/emails/${id}`);
  expectEqual(
    [email.messageId, email.subject, email.envelope],
    [MESSAGE_ID, SUBJECT, ENVELOPE],
    `${name} email over REST`,
  );
  const source = await get(`${server.baseUrl}/api/emails/${id}/raw`, 'bytes');
  expectEqual(sha256(source), sha256(raw), `${name} raw source`);
  const attachment = await get(
    `${server.baseUrl}/api/emails/${id}/attachments/0`,
    'bytes',
  );
  expectEqual(sha256(attachment), sha256(ATTACHMENT), `${name} attachment`);
  ok(`${name}: SMTP -> REST (message, envelope, raw bytes, attachment)`);
  return id;
}

async function checkWeb(server) {
  const index = await fetch(`${server.baseUrl}/`);
  const html = await index.text();
  expectEqual(index.status, 200, 'Status of the web inbox');
  const assets = webAssets(html);
  for (const asset of assets) {
    const response = await fetch(`${server.baseUrl}${asset}`);
    await response.arrayBuffer();
    const type = response.headers.get('content-type') ?? '';
    expectTrue(
      response.status === 200 && /javascript|css|svg|font|image/.test(type),
      `${asset} answered ${response.status} with ${type}`,
    );
  }
  const deepLink = await fetch(`${server.baseUrl}/emails/1`);
  expectEqual(await deepLink.text(), html, 'A deep link of the web inbox');
  const missing = await fetch(`${server.baseUrl}/api/missing`);
  const body = await missing.json();
  expectEqual(
    [missing.status, body.error?.code],
    [404, 'NOT_FOUND'],
    'An unknown API path',
  );
  const docs = await get(`${server.baseUrl}/swagger/json`);
  expectTrue(docs.paths?.['/api/emails'], 'The OpenAPI document is incomplete');
  ok(
    `mail-debugger: web inbox with ${assets.length} assets, deep link, API 404, OpenAPI`,
  );
}

async function checkClientReads(consumer, server, id, raw) {
  const result = await runHelper(consumer, 'client-read.mjs', [
    server.baseUrl,
    String(id),
  ]);
  expectEqual(result.code, 0, `Exit code of the client read: ${result.stderr}`);
  expectEqual(
    JSON.parse(result.stdout),
    {
      messageId: MESSAGE_ID,
      raw: sha256(raw),
      attachment: sha256(ATTACHMENT),
      filename: 'bytes.bin',
      total: 1,
      highWatermark: id,
    },
    'What the installed client read',
  );
  ok('mail-debugger/client: email, raw bytes and attachment from the server');
}

async function checkCliRead(consumer, bin, prefix, server, id) {
  const args = [...prefix, '--api-url', server.baseUrl];
  const shown = await runInstalled(consumer, bin, [
    ...args,
    'show',
    String(id),
    '--json',
  ]);
  expectEqual(shown.code, 0, `Exit code of ${bin} show: ${shown.stderr}`);
  const email = JSON.parse(shown.stdout);
  const attachment = Buffer.from(email.attachments[0].content, 'base64');
  expectEqual(
    [email.messageId, email.subject, sha256(attachment)],
    [MESSAGE_ID, SUBJECT, sha256(ATTACHMENT)],
    `${bin} show --json`,
  );
  const listed = await runInstalled(consumer, bin, [...args, 'list']);
  expectTrue(
    listed.code === 0 && listed.stdout.includes(SUBJECT),
    `${bin} list did not show the email`,
    listed.stdout + listed.stderr,
  );
  ok(`${[bin, ...prefix].join(' ')}: show --json and list against the server`);
}

async function checkImap(server, raw, name) {
  const client = new ImapFlow({
    host: '127.0.0.1',
    port: server.imapPort,
    secure: false,
    doSTARTTLS: false,
    auth: DEV_LOGIN,
    logger: false,
    disableAutoIdle: true,
  });
  client.on('error', () => {
    // Failures surface through the awaited calls.
  });
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    const message = await client.fetchOne('*', { source: true });
    expectEqual(sha256(message.source), sha256(raw), `${name} IMAP source`);
    const download = await client.download('*', '2');
    const attachment = Buffer.concat(await Array.fromAsync(download.content));
    expectEqual(
      sha256(attachment),
      sha256(ATTACHMENT),
      `${name} IMAP attachment`,
    );
    await client.logout();
  } finally {
    client.close();
  }
  ok(`${name}: SMTP -> IMAP with ImapFlow (source and attachment)`);
}

/** Reads the email and its attachment with an MCP client. */
async function readOverMcp(client, id, what) {
  const { tools } = await client.listTools();
  expectEqual(
    tools.map((tool) => tool.name).toSorted(byCodeUnit),
    READ_TOOLS,
    `${what}: tools`,
  );
  const email = await client.callTool({ name: 'get_email', arguments: { id } });
  expectEqual(email.structuredContent?.messageId, MESSAGE_ID, `${what}: email`);
  const chunk = await client.callTool({
    name: 'get_email_attachment',
    arguments: { id, index: 0 },
  });
  const bytes = Buffer.from(
    chunk.structuredContent?.dataBase64 ?? '',
    'base64',
  );
  expectEqual(sha256(bytes), sha256(ATTACHMENT), `${what}: attachment`);
}

function mcpClient() {
  return new Client(
    { name: 'mail-debugger-smoke', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
}

async function checkMcpHttp(server, id, name) {
  const client = mcpClient();
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)),
    );
    await readOverMcp(client, id, `${name} MCP over HTTP`);
  } finally {
    await client.close();
  }
  ok(`${name}: SMTP -> MCP over HTTP (tools, email, attachment)`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkMcpBridge(consumer, server, id) {
  const transport = new StdioClientTransport({
    command: shim(consumer, 'mail-debugger'),
    args: ['mcp', '--url', `${server.baseUrl}/mcp`],
    cwd: consumer,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => (stderr += chunk));
  const client = mcpClient();
  let pid;
  try {
    await client.connect(transport);
    pid = transport.pid;
    await readOverMcp(client, id, 'stdio bridge');
  } catch (error) {
    throw new SmokeError(`The stdio bridge failed: ${error.message}`, stderr);
  } finally {
    await client.close();
  }
  const deadline = Date.now() + 10_000;
  while (pid && isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expectTrue(!pid || !isAlive(pid), 'The stdio bridge kept running after EOF');
  ok('mail-debugger mcp: the installed command bridges stdio and exits on EOF');
}

// ---------------------------------------------------------------------------

async function smokeMainPackage(consumers, raw, version) {
  const consumer = consumers.get('mail-debugger');
  const server = await startServer(consumer, 'mail-debugger', 'mail-debugger', [
    '--imap',
    '--mcp',
  ]);
  try {
    await sendMessage(server.smtpPort, raw);
    const id = await checkRest(server, raw, version, 'mail-debugger');
    await checkWeb(server);
    await checkClientReads(consumer, server, id, raw);
    await checkCliRead(consumer, 'mail-debugger', ['cli'], server, id);
    await checkImap(server, raw, 'mail-debugger');
    await checkMcpHttp(server, id, 'mail-debugger');
    await checkMcpBridge(consumer, server, id);
  } catch (error) {
    throw new SmokeError(error.message, `Server output:\n${server.output()}`);
  }
  await server.stop();
}

async function smokeSlimPackage(consumers, raw, version) {
  const server = await startServer(
    consumers.get('mail-debugger-api'),
    'mail-debugger-api',
    'mail-debugger-api',
    ['--imap', '--mcp'],
  );
  try {
    await sendMessage(server.smtpPort, raw);
    const id = await checkRest(server, raw, version, 'mail-debugger-api');
    const index = await fetch(`${server.baseUrl}/`);
    await index.arrayBuffer();
    expectEqual(index.status, 404, 'Status of / in mail-debugger-api');
    await checkImap(server, raw, 'mail-debugger-api');
    await checkMcpHttp(server, id, 'mail-debugger-api');
    await checkCliRead(
      consumers.get('mail-debugger-cli'),
      'mail-debugger-cli',
      [],
      server,
      id,
    );
  } catch (error) {
    throw new SmokeError(error.message, `Server output:\n${server.output()}`);
  }
  await server.stop();
}

async function main() {
  const { values } = parseArgs({
    options: {
      'pack-only': { type: 'boolean' },
      tarballs: { type: 'string' },
      keep: { type: 'boolean' },
    },
    strict: true,
  });
  keepWorkDir = values.keep === true;
  const started = Date.now();
  const version = workspaceVersion();
  console.log(
    `Smoke test of mail-debugger ${version} on Node ${process.version} (${process.platform}-${process.arch})`,
  );
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-smoke-'));

  let tarballs;
  if (values.tarballs) {
    tarballs = findTarballs(path.resolve(values.tarballs), version);
  } else {
    assertBuilt();
    const packDir = process.env.MAIL_DEBUGGER_PACK_DIR
      ? path.resolve(process.env.MAIL_DEBUGGER_PACK_DIR)
      : path.join(workDir, 'tarballs');
    fs.mkdirSync(packDir, { recursive: true });
    expectTrue(
      fs.readdirSync(packDir).length === 0,
      `${packDir} must be empty, so that it holds only the new tarballs`,
    );
    tarballs = await pack(packDir);
  }

  const footprint = new Map();
  for (const distribution of DISTRIBUTIONS) {
    const file = tarballs.get(distribution.name);
    footprint.set(
      distribution.name,
      inspectTarball(distribution, file, version),
    );
  }
  if (values['pack-only']) {
    for (const file of tarballs.values()) console.log(`      ${file}`);
    return;
  }

  const consumers = new Map();
  for (const distribution of DISTRIBUTIONS) {
    const { name } = distribution;
    const consumer = await install(tarballs.get(name), name);
    consumers.set(name, consumer);
    Object.assign(footprint.get(name), checkTree(consumer, name));
  }

  await checkCommandLines(consumers, version);
  const full = consumers.get('mail-debugger');
  await checkClientImport(full);
  await checkClientTypes(full);
  await checkInboxEngine(full, 'mail-debugger', 'mail-debugger');
  await checkInboxEngine(
    consumers.get('mail-debugger-cli'),
    'mail-debugger-cli',
    'mail-debugger-cli',
  );
  const raw = multipartMessage();
  await smokeMainPackage(consumers, raw, version);
  await smokeSlimPackage(consumers, raw, version);

  console.log('\nFootprint: tarball, unpacked, files; production install');
  for (const [name, size] of footprint) {
    console.log(
      `  ${name.padEnd(18)} ${formatBytes(size.packed).padStart(10)} ${formatBytes(size.unpacked).padStart(10)} ${String(size.files).padStart(4)} files; ${String(size.packages).padStart(3)} packages, ${formatBytes(size.bytes)}`,
    );
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nAll checks passed in ${seconds} s.`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof SmokeError ? error.message : error.stack;
  console.error(`\nFAIL  ${message}`);
  if (keepWorkDir && workDir) console.error(`Kept ${workDir}`);
  process.exitCode = 1;
}
