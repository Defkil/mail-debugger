import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.dirname(import.meta.dirname);
const names = ['mail-debugger', 'mail-debugger-api', 'mail-debugger-cli'];

function temporary(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mail-debugger-release-test-'),
  );
  try {
    return run(directory);
  } finally {
    // Only remove the directory this test created, never its parent.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

function tarball(name) {
  const content = Buffer.from(JSON.stringify({ name, version: '0.4.0' }));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  header.write(content.length.toString(8).padStart(11, '0'), 124);
  return zlib.gzipSync(
    Buffer.concat([
      header,
      content,
      Buffer.alloc(512 - content.length),
      Buffer.alloc(1024),
    ]),
  );
}

function publishFixture(directory, scenario) {
  const tarballs = path.join(directory, 'release %literal% & files');
  fs.mkdirSync(tarballs);
  const integrities = {};
  for (const name of names) {
    const bytes = tarball(name);
    fs.writeFileSync(path.join(tarballs, `${name}-0.4.0.tgz`), bytes);
    integrities[name] =
      `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  }
  const mock = path.join(directory, 'mock.mjs');
  const log = path.join(directory, 'calls.json');
  // Mock npm and fetch inside the child before the release script imports
  // them. Tests cannot invoke a real npm publish or contact the registry.
  fs.writeFileSync(
    mock,
    `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const integrities = ${JSON.stringify(integrities)};
const scenario = ${JSON.stringify(scenario)};
const calls = [];
const uploaded = new Set();
const record = (call) => { calls.push(call); fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls)); };
childProcess.spawnSync = (command, args) => {
  record({ command, args });
  if (args.includes('--version')) return { status: 0, stdout: '12.2.0\\n' };
  if (!args.includes('publish')) throw new Error('Unexpected subprocess');
  const file = args[args.indexOf('publish') + 1];
  uploaded.add(Object.keys(integrities).find(name => file.endsWith(name + '-0.4.0.tgz')));
  return { status: 0 };
};
syncBuiltinESMExports();
globalThis.fetch = async (url) => {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  record({ lookup: name });
  if (scenario === 'unavailable' && name === 'mail-debugger-cli') throw new Error('offline');
  let versions = {};
  if (scenario === 'malformed' && name === 'mail-debugger-cli') versions = undefined;
  if (scenario === 'missing-integrity' && name === 'mail-debugger-cli') versions = { '0.4.0': {} };
  if (scenario === 'conflict' && name === 'mail-debugger-cli') versions = { '0.4.0': { dist: { integrity: 'sha512-' + Buffer.alloc(64, 7).toString('base64') } } };
  if (scenario === 'same' || uploaded.has(name) || (scenario === 'partial' && name === 'mail-debugger')) versions = { '0.4.0': { dist: { integrity: integrities[name] } } };
  return { status: 200, ok: true, json: async () => ({ versions }) };
};
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(mock).href,
      path.join(root, 'scripts/publish-tarballs.mjs'),
      tarballs,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(fs.existsSync(log), true, result.stderr);
  return {
    ...result,
    calls: JSON.parse(fs.readFileSync(log, 'utf8')),
    tarballs,
  };
}

for (const scenario of [
  'conflict',
  'missing-integrity',
  'malformed',
  'unavailable',
]) {
  test(`publishing refuses ${scenario} in the last package before any upload`, () =>
    temporary((directory) => {
      const result = publishFixture(directory, scenario);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(
        result.calls.filter((call) => call.args?.includes('publish')).length,
        0,
      );
      assert.deepEqual(
        result.calls.filter((call) => call.lookup).map((call) => call.lookup),
        names,
      );
    }));
}

for (const scenario of ['absent', 'same', 'partial']) {
  test(`publishing handles ${scenario} versions using the exact tested paths`, () =>
    temporary((directory) => {
      const result = publishFixture(directory, scenario);
      assert.equal(result.status, 0, result.stderr);
      const uploads = result.calls.filter((call) =>
        call.args?.includes('publish'),
      );
      const expected =
        scenario === 'same'
          ? []
          : scenario === 'partial'
            ? names.slice(1)
            : names;
      assert.equal(uploads.length, expected.length);
      for (const [index, call] of uploads.entries()) {
        assert.deepEqual(call.args.slice(call.args.indexOf('publish')), [
          'publish',
          path.join(result.tarballs, `${expected[index]}-0.4.0.tgz`),
          '--provenance',
          '--access',
          'public',
          '--registry',
          'https://registry.npmjs.org',
        ]);
        assert.equal(
          result.calls
            .slice(0, result.calls.indexOf(call))
            .filter((item) => item.lookup).length >= names.length,
          true,
        );
      }
    }));
}

function git(directory, ...args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function releaseFixture(directory, date = '2026-10-11') {
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.copyFileSync(
    path.join(root, 'scripts/verify-release.mjs'),
    path.join(directory, 'scripts/verify-release.mjs'),
  );
  for (const [index, relative] of [
    'package.json',
    'packages/api/package.json',
    'packages/cli/package.json',
  ].entries()) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ name: names[index], version: '0.4.0' }),
    );
  }
  fs.writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    `## [0.4.0] - ${date}\n`,
  );
  git(directory, 'init', '--initial-branch=main');
  git(directory, 'add', '.');
  git(
    directory,
    '-c',
    'user.name=Release tests',
    '-c',
    'user.email=tests@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'test: prepare release fixture',
  );
  git(directory, 'tag', 'v0.4.0');
  git(directory, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

function verify(directory, tag = 'v0.4.0') {
  return spawnSync(
    process.execPath,
    [path.join(directory, 'scripts/verify-release.mjs'), tag],
    { encoding: 'utf8' },
  );
}

test('release verification accepts a stable tag on main with matching versions', () =>
  temporary((directory) => {
    releaseFixture(directory);
    const result = verify(directory);
    assert.equal(result.status, 0, result.stderr);
  }));

test('release verification refuses invalid calendar dates', () =>
  temporary((directory) => {
    releaseFixture(directory, '2026-02-30');
    const result = verify(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid release date/);
  }));

test('release verification refuses prerelease tags and mismatched versions', () =>
  temporary((directory) => {
    releaseFixture(directory);
    assert.equal(verify(directory, 'v0.4.0-beta.1').status, 1);
    fs.writeFileSync(
      path.join(directory, 'packages/api/package.json'),
      JSON.stringify({ name: names[1], version: '0.4.1' }),
    );
    const result = verify(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has version 0\.4\.1/);
  }));

test('release verification refuses a tag commit outside main', () =>
  temporary((directory) => {
    releaseFixture(directory);
    const baseline = git(directory, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(directory, 'branch-change.txt'), 'unmerged\n');
    git(directory, 'add', '.');
    git(
      directory,
      '-c',
      'user.name=Release tests',
      '-c',
      'user.email=tests@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'test: prepare unmerged fixture',
    );
    git(directory, 'tag', '--force', 'v0.4.0');
    git(directory, 'update-ref', 'refs/remotes/origin/main', baseline);
    const result = verify(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not reachable from origin\/main/);
  }));
