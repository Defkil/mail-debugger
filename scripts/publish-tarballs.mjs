#!/usr/bin/env node
// Publishes the tarballs that pack-and-smoke packed and tested, with npm
// trusted publishing (OIDC) and provenance, in a fixed order. Only the
// publish workflow runs this.
//
// Publishing three packages is not atomic. Before any upload the script
// asks the registry for all three exact versions:
//   - absent: publish the tarball,
//   - present with the same integrity: skip it (a rerun after a partial
//     release),
//   - present with other contents: stop for a maintainer's review.
// A failed registry request stops the run; it never counts as "absent".
//
// Usage: node scripts/publish-tarballs.mjs <dir>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { npmCommand } from './npm-command.mjs';

const dir = process.argv[2];
if (!dir || process.argv.length !== 3) {
  console.error('Usage: node scripts/publish-tarballs.mjs <dir>');
  process.exit(2);
}

const ORDER = ['mail-debugger', 'mail-debugger-api', 'mail-debugger-cli'];
const REGISTRY = 'https://registry.npmjs.org';
const PUBLISH_NPM = '12.2.0';

/** Runs npm without passing paths or arguments through a shell. */
function npm(args, options) {
  const invocation = npmCommand(args);
  return spawnSync(invocation.command, invocation.args, options);
}

function fail(message) {
  console.error(`publish-tarballs: ${message}`);
  process.exit(1);
}

/** package.json of an npm tarball. */
function manifestOf(file) {
  const archive = zlib.gunzipSync(fs.readFileSync(file));
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(
      header.subarray(124, 136).toString('utf8').trim() || '0',
      8,
    );
    if (name === 'package/package.json') {
      return JSON.parse(
        archive.subarray(offset + 512, offset + 512 + size).toString('utf8'),
      );
    }
    if (header.every((byte) => byte === 0)) break;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return fail(`${file} has no package/package.json`);
}

function integrityOf(file) {
  const digest = createHash('sha512').update(fs.readFileSync(file)).digest();
  return `sha512-${digest.toString('base64')}`;
}

/** The integrity of a published version, or undefined if it is not published. */
async function publishedIntegrity(name, version) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return fail(`cannot reach ${url}: ${error.message}`);
  }
  if (response.status === 404) {
    return fail(
      `${name} does not exist on npm; a new package needs a trusted publisher first`,
    );
  }
  if (!response.ok) {
    return fail(`${url} answered ${response.status}`);
  }
  const document = await response.json();
  if (
    !document.versions ||
    typeof document.versions !== 'object' ||
    Array.isArray(document.versions)
  ) {
    return fail(`${url} returned no version map; refusing to publish`);
  }
  if (!Object.hasOwn(document.versions, version)) return undefined;
  const integrity = document.versions[version]?.dist?.integrity;
  if (
    typeof integrity !== 'string' ||
    !/^sha512-[A-Za-z\d+/]{86}==$/.test(integrity)
  ) {
    return fail(
      `${name}@${version} already exists without a valid SHA-512 integrity; a maintainer must review it`,
    );
  }
  return integrity;
}

const versionResult = npm(['--version'], { encoding: 'utf8' });
if (versionResult.status !== 0 || versionResult.error) {
  fail(
    `cannot run npm: ${versionResult.error?.message ?? versionResult.stderr}`,
  );
}
const npmVersion = versionResult.stdout.trim();
if (npmVersion !== PUBLISH_NPM) {
  fail(`publishing needs npm ${PUBLISH_NPM}, found ${npmVersion}`);
}

const tarballs = fs
  .readdirSync(dir)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => path.resolve(dir, file));
const releases = ORDER.map((name) => {
  const matching = tarballs.filter((file) => manifestOf(file).name === name);
  if (matching.length !== 1) {
    fail(`expected one tarball of ${name} in ${dir}, found ${matching.length}`);
  }
  const [file] = matching;
  return {
    name,
    file,
    version: manifestOf(file).version,
    integrity: integrityOf(file),
  };
});
const versions = new Set(releases.map((release) => release.version));
if (versions.size !== 1 || tarballs.length !== ORDER.length) {
  fail(`${dir} must hold exactly the three tarballs of one version`);
}

// Check every package first: an existing mismatch or failed registry request
// must stop the run before an otherwise missing package can be uploaded.
const publishedVersions = new Map();
for (const release of releases) {
  const label = `${release.name}@${release.version}`;
  const published = await publishedIntegrity(release.name, release.version);
  if (published !== undefined && published !== release.integrity) {
    fail(
      `${label} is already published with other contents (${published}, this tarball is ${release.integrity}). ` +
        'Nothing was published by this run. A maintainer must review this release.',
    );
  }
  publishedVersions.set(release.name, published);
}

const done = [];
for (const release of releases) {
  const label = `${release.name}@${release.version}`;
  const published = publishedVersions.get(release.name);
  if (published === release.integrity) {
    console.log(`${label} is already published with this tarball; skipped.`);
    done.push(`${label} (already published)`);
    continue;
  }
  console.log(`Publishing ${label} from ${path.basename(release.file)}`);
  const result = npm(
    [
      'publish',
      release.file,
      '--provenance',
      '--access',
      'public',
      '--registry',
      REGISTRY,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    const pending = releases
      .slice(releases.indexOf(release))
      .map((item) => item.name);
    fail(
      `npm publish of ${label} failed. Published: ${done.join(', ') || 'none'}. ` +
        `Not published: ${pending.join(', ')}. Rerun the workflow for the same tag once the cause is fixed; ` +
        'published versions are skipped when their contents match.',
    );
  }
  done.push(label);
  await confirmPublished(release, label);
}

console.log(`Done: ${done.join(', ')}.`);

/** Waits until the registry serves the new version with this tarball. */
async function confirmPublished(release, label) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const published = await publishedIntegrity(release.name, release.version);
    if (published === release.integrity) {
      console.log(`${label} is on npm with the tested tarball.`);
      return;
    }
    if (published !== undefined) {
      fail(`${label} is on npm with other contents (${published})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.warn(
    `${label} was published, but the registry did not list it within a minute; check it with npm view ${label}.`,
  );
}
