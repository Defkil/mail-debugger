// Runs in a project that installed mail-debugger from its tarball.
// Imports the public client and reports what the import did: its exports,
// the failing root import, and any handle (socket, timer, file) it opened.
const before = process.getActiveResourcesInfo().length;
const client = await import('mail-debugger/client');
const resources = process.getActiveResourcesInfo().slice(before);

let root = 'importable';
try {
  await import('mail-debugger');
} catch (error) {
  root = error.code;
}

process.stdout.write(
  JSON.stringify({ exports: Object.keys(client), root, resources }),
);
