# Changelog

All notable changes to `mail-debugger`, `mail-debugger-api` and `mail-debugger-cli` are documented here. The three packages are released together with the same version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may contain breaking changes; they are marked in **Changed**.

## [Unreleased]

## [0.4.0] - 2026-10-11

This release adds the JavaScript client, an IMAP inbox and MCP, and makes the server safe by default. Several defaults changed; read **Changed** before upgrading.

### Added

- `mail-debugger/client`: a typed ESM client for the REST API without dependencies, for Node.js and browsers. `createApiClient(baseUrl, { token, headers, timeoutMs, fetch })` offers `health`, `listEmails` (positional or `{ filter, limit, offset }`), `getEmail`, `getRawEmail`, `getAttachment`, `waitForEmail`, `deleteEmail` and `deleteAllEmails`, with abort signals, a 10-second default timeout and the errors `MailDebuggerApiError`, `MailDebuggerNetworkError` and `MailDebuggerTimeoutError`. The root import `mail-debugger` is not exported.
- REST API: `GET /api/emails/wait` waits for the first matching email above a cursor (up to 60 seconds); `GET /api/emails/:id/raw` returns the exact source bytes; `GET /api/emails/:id/attachments/:index` downloads one attachment. List responses carry the cursor `highWatermark` and `mailboxId`, emails carry the SMTP `envelope` including Bcc recipients, and `GET /api/health` reports `version`, `imapPort` and `mcp`.
- `mail-debugger cli`: the terminal client as a command of the main package, with the new `list --limit/--offset` and `wait` (exit code 1 on timeout), JSON output and exit codes 0, 1 and 2. `mail-debugger serve` is the explicit form of the server command.
- IMAP inbox with `--imap` and `--imap-port` (1143, or 1993 with `--tls implicit`): one shared `INBOX` that mail clients and IMAP libraries can read, flag and expunge, with changes shared with every other surface. It is a restricted RFC 3501 profile: no other mailboxes, no `APPEND`, `COPY`, `MOVE` or `CREATE`, no IMAP4rev2, CONDSTORE or QRESYNC; at most 20 sessions; development login `mail-debugger` / `mail-debugger` unless `--auth-user` is set. Desktop clients are documented setup targets; the tests use ImapFlow and raw protocol transcripts. See `docs/imap.md`.
- MCP for AI agents with `--mcp`: streamable HTTP at `/mcp` with six read-only tools (`list_emails`, `search_emails`, `get_email`, `wait_for_email`, `list_email_attachments`, `get_email_attachment`); `--mcp-allow-mutations` adds `delete_email` and `clear_emails`. `MAIL_DEBUGGER_MCP_TOKEN` requires a bearer token. `mail-debugger mcp --url <url>` is a stdio bridge for clients that start processes. Limits: stateless (no sessions), results up to 1 MiB, attachments in chunks of up to 64 KiB, 32 pending waits and 64 requests at once; 2025-era HTTP clients cannot cancel a running wait, which then ends at its timeout of at most 30 seconds. See `docs/mcp.md`.
- Options `--host`, `--data-dir`, `--tls-cert` and `--tls-key`, `--auth-user` with `MAIL_DEBUGGER_AUTH_PASSWORD` or `--auth-password-file`, `--allow-insecure-auth`, `--max-message-bytes`, `--max-messages`, `--max-storage-bytes`, `--http-allowed-host`, `--http-allowed-origin`, `--help` and `--version`. Port `0` picks a free port; the bound ports are logged and reported by the health endpoint.
- `MAIL_DEBUGGER_API_TOKEN` protects the REST API with a bearer token; the web inbox asks for it and keeps it in memory only.
- The license text in all three packages, this changelog, a contributing guide, a code of conduct and a security policy.

### Changed

- **Node.js 22.17.0 or later** is required (was 20).
- **All listeners bind `127.0.0.1`** instead of every interface. `--host` chooses another address; anything but loopback is refused unless SMTP and IMAP use TLS, mail clients authenticate with `--auth-user`, `MAIL_DEBUGGER_API_TOKEN` is set and, with `--mcp`, `MAIL_DEBUGGER_MCP_TOKEN` is set.
- HTTP requests must carry an allowed `Host` header and, if present, an allowed `Origin`; others get 403.
- Unknown, repeated or malformed options exit with code 2 instead of being ignored. A port in use exits with code 1.
- REST errors are objects, `{ "error": { "code", "message" } }`, instead of strings. `GET /api/emails` returns at most 50 emails unless `limit` (1 to 200) is given; `offset` also works without `limit`. Text filters match literally and case-insensitively, date bounds are inclusive and validated, and timestamps are UTC ISO 8601 with milliseconds.
- Email ids are never reused, also after deleting all mail.
- Persistent storage: `--persist` keeps `mail-debugger.sqlite` in the working directory, `--data-dir` in another one. A 0.3 database is migrated on the first start after a backup copy (`mail-debugger.sqlite.schema1.bak`); message bytes that 0.3 could not store as UTF-8 stay replaced. Changes are written 250 ms after they happen and on shutdown, atomically, and only one server can use a directory at a time.
- New mail is refused once a limit is reached instead of being stored without bound: 552 above `--max-message-bytes` (25 MiB), 452 at `--max-messages` (1000) or `--max-storage-bytes` (250 MiB). SMTP advertises `SIZE`.
- With `--auth-user`, SMTP requires that account, over TLS unless `--allow-insecure-auth` is given; without it, any credentials are still accepted.
- The terminal client connects to `http://127.0.0.1:3000` by default, reads its token from `MAIL_DEBUGGER_API_TOKEN`, rejects unknown, repeated or misplaced options, and exits with code 2 instead of starting the interactive inbox when there is no terminal.
- `mail-debugger-cli` depends only on `@rezi-ui/native`, which ships prebuilt binaries, and installs 2 packages instead of 7 (5.7 MiB instead of 74 MiB).
- The OpenAPI document is generated by `@elysiajs/openapi`, at the same `/swagger` and `/swagger/json` paths.
- The packages are built, tested as installed tarballs and published by CI with npm provenance.

### Fixed

- Message sources are stored as the exact bytes SMTP received; 0.3 stored decoded text, which changed bytes that were not UTF-8.
- Static files of the web inbox are resolved strictly inside its directory, with the same rules on every platform; directories are not served.
- The help of `mail-debugger-api` no longer mentions a web inbox.

### Security

- The HTML preview of the web inbox runs with a Content-Security-Policy that blocks scripts, requests, frames and form submissions; remote images load only on request.
- The terminal client replaces control characters of captured mail, so escape sequences in a message cannot act on the terminal.
- Attachment and source downloads are served with safe content types, `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy.
- Passwords and tokens are compared in constant time and never logged.

## [0.3.2] - 2026-04-17

### Fixed

- `mail-debugger-cli` declares its runtime dependencies `@rezi-ui/core` and `@rezi-ui/node`.

## [0.3.1] - 2026-04-17

No changes to the code of the packages: the CI and publish workflows were repaired. 0.3.1 is the first `mail-debugger-cli` release of the 0.3 line.

## [0.3.0] - 2026-04-17

### Added

- `mail-debugger-cli`, a terminal client with an interactive inbox and the commands `list`, `show`, `delete`, `delete-all` and `health`, with `--json` and filter options. A first version was published to npm as `mail-debugger-cli` 0.2.3 on 2026-04-15.

## [0.2.3] - 2026-04-14

### Changed

- The remaining German strings of the code are translated to English.

## [0.2.2] - 2026-04-14

### Fixed

- `mail-debugger-api` bundles its CommonJS dependencies (smtp-server, mailparser, Elysia), so the slim binary starts.

## [0.2.1] - 2026-04-14

No code changes since 0.2.0. `mail-debugger-api` has no 0.2.0 release on npm; 0.2.1 is its first release after 0.1.0.

## [0.2.0] - 2026-04-14

### Changed

- Storage uses sql.js (SQLite as WebAssembly) instead of better-sqlite3, whose install script pnpm 10 blocks by default, so the server starts without native bindings.
- `mail-debugger-api` declares pino and pino-pretty as runtime dependencies.

## 0.1.0 - 2026-04-14

### Added

- First release of `mail-debugger` and `mail-debugger-api`: an SMTP server that catches every message, with optional STARTTLS or implicit TLS and optional authentication; a REST API with Swagger UI to list, filter, page, read and delete emails; a web inbox with filters, pagination, an email view with text, HTML and source tabs, attachments and a light and dark theme; storage in memory or with `--persist`. `mail-debugger-api` is the same server without the web inbox.

[Unreleased]: https://github.com/Defkil/mail-debugger/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Defkil/mail-debugger/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Defkil/mail-debugger/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Defkil/mail-debugger/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Defkil/mail-debugger/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/Defkil/mail-debugger/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Defkil/mail-debugger/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Defkil/mail-debugger/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Defkil/mail-debugger/compare/v0.1.1...v0.2.0
