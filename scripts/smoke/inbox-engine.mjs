// Runs in a project that installed mail-debugger or mail-debugger-cli.
// Imports the chunk of the interactive inbox and loads its native engine,
// which needs no terminal, then prints the chunk's exports.
// Usage: node inbox-engine.mjs <file URL of the chunk>
const inbox = await import(process.argv[2]);
await inbox.loadTerminalEngine();
process.stdout.write(JSON.stringify(Object.keys(inbox)));
// The engine module may keep handles open; this check is done.
process.exit(0);
