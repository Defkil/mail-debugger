#!/usr/bin/env node
// Checks that a release tag may be published, before anything is built:
//   - the tag is a stable vMAJOR.MINOR.PATCH (no pre-release or build
//     metadata until a deliberate npm dist-tag policy exists),
//   - the checked-out commit is the tag's commit and is reachable from
//     origin/main,
//   - mail-debugger, mail-debugger-api and mail-debugger-cli all carry the
//     tag's version,
//   - CHANGELOG.md has a dated section for that version.
//
// Usage: node scripts/verify-release.mjs <tag>
// Run it in a checkout with the full history and origin/main fetched, after
// creating the tag and before pushing it. The publish workflow runs it too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tag = process.argv[2];
if (!tag || process.argv.length !== 3) {
  console.error('Usage: node scripts/verify-release.mjs <tag>');
  process.exit(2);
}

const root = path.dirname(import.meta.dirname);
const MANIFESTS = [
  'package.json',
  'packages/api/package.json',
  'packages/cli/package.json',
];
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`verify-release: ${message}`);
  process.exit(1);
}

if (!STABLE_TAG.test(tag)) {
  fail(`${tag} is not a stable release tag of the form vMAJOR.MINOR.PATCH`);
}
const version = tag.slice(1);

let tagCommit;
try {
  tagCommit = git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^0`);
} catch {
  fail(`the tag ${tag} does not exist in this checkout`);
}
const head = git('rev-parse', 'HEAD');
if (head !== tagCommit) {
  fail(`HEAD is ${head}, but ${tag} points to ${tagCommit}; check out the tag`);
}
try {
  git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main');
} catch {
  fail('origin/main is missing; fetch it first (git fetch origin main)');
}
try {
  git('merge-base', '--is-ancestor', tagCommit, 'refs/remotes/origin/main');
} catch {
  fail(
    `${tag} (${tagCommit}) is not reachable from origin/main; release from main only`,
  );
}

for (const manifest of MANIFESTS) {
  const { name, version: found } = JSON.parse(
    fs.readFileSync(path.join(root, manifest), 'utf8'),
  );
  if (found !== version) {
    fail(`${name} (${manifest}) has version ${found}, but the tag is ${tag}`);
  }
}

const changelogFile = path.join(root, 'CHANGELOG.md');
if (!fs.existsSync(changelogFile)) fail('CHANGELOG.md is missing');
const changelog = fs.readFileSync(changelogFile, 'utf8');
const heading = new RegExp(
  String.raw`^## \[${version.replaceAll('.', String.raw`\.`)}\] - (\d{4}-\d{2}-\d{2})$`,
  'm',
);
const dated = heading.exec(changelog);
if (!dated) {
  fail(`CHANGELOG.md has no section "## [${version}] - YYYY-MM-DD"`);
}

console.log(
  `verify-release: ${tag} is ${tagCommit} on main; all three distributions are ${version}; the changelog dates it ${dated[1]}.`,
);
