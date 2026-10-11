#!/usr/bin/env node
// Replaces a build output directory with a fresh copy of another directory,
// so that no stale file of an earlier build survives.
//
// Usage: node scripts/copy-dir.mjs <from> <to>
// Both paths are relative to the workspace root and must stay inside it.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node scripts/copy-dir.mjs <from> <to>');
  process.exit(2);
}

/** Resolves a path inside the workspace; refuses the root and anything outside. */
function inside(value) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    console.error(`copy-dir: ${value} is not a directory inside the workspace`);
    process.exit(2);
  }
  return resolved;
}

const source = inside(args[0]);
const target = inside(args[1]);
if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`copy-dir: ${args[0]} does not exist; build it first`);
  process.exit(1);
}
if (
  source === target ||
  target.startsWith(source + path.sep) ||
  source.startsWith(target + path.sep)
) {
  console.error('copy-dir: the source and the target must not overlap');
  process.exit(2);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
