# mail-debugger

[![npm](https://img.shields.io/npm/v/mail-debugger)](https://www.npmjs.com/package/mail-debugger)
[![CI](https://github.com/Defkil/mail-debugger/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Defkil/mail-debugger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mail-debugger)](LICENSE)

Local SMTP email catcher with a web inbox, REST API, typed client, IMAP, and MCP for development and testing.

Point the SMTP settings of the application you develop at mail-debugger. Every message it sends lands in one local inbox instead of a real mailbox, where you can read it in the browser, query it from tests, script it from a terminal, open it in a mail client or hand it to an AI agent.

> **For development and testing only.** mail-debugger accepts every message and shows it to anyone who can reach its ports. By default all listeners bind `127.0.0.1`. It never delivers mail. See [SECURITY.md](SECURITY.md).

## Features

- **SMTP capture** on port 2525: every recipient accepted, nothing delivered; plaintext, STARTTLS or implicit TLS; optional authentication (PLAIN, LOGIN); `SIZE`; the SMTP envelope including Bcc recipients; the exact source bytes of each message.
- **Web inbox** on port 3000: filter, page and read mail with its headers and raw source; HTML mail is shown in a sandbox without scripts or network requests (remote images load on request); attachments download.
- **REST API** with an OpenAPI document at `/swagger`: list, filter, wait for the next email, download sources and attachments, delete.
- **Typed client** `mail-debugger/client` for JavaScript and TypeScript tests (ESM, no dependencies).
- **Terminal client** `mail-debugger cli`: scriptable commands with JSON output, `wait` for CI, and an interactive inbox.
- **IMAP inbox** (opt-in, `--imap`): one shared INBOX for mail clients and IMAP libraries.
- **MCP** (opt-in, `--mcp`): read-only tools for AI agents over streamable HTTP, plus a stdio bridge.
- **Persistence** (opt-in), size and count limits, tokens and safe defaults.

### Limits by design

- It is a development catcher, not a mail server: no delivery, relaying, mailboxes per user, spam or DKIM checks.
- IMAP is a restricted RFC 3501 profile with exactly one mailbox, `INBOX`. Clients can read, flag and delete; they cannot create folders, upload, copy or move messages. It is tested with [ImapFlow](https://github.com/postalsys/imapflow); desktop clients are documented setup targets, not GUI-tested. Details in [docs/imap.md](docs/imap.md).
- MCP is stateless streamable HTTP with optional bearer-token authentication on loopback and no OAuth. Results are capped at 1 MiB and attachments are read in chunks of up to 64 KiB. Clients of the 2025 protocol revisions cannot cancel a running wait over HTTP; it ends at its timeout (at most 30 seconds). Details in [docs/mcp.md](docs/mcp.md).
- Storage is one process per data directory. Persistent mail is snapshotted to disk 250 ms after each change, so a killed process can lose the last moments.

## Quick start

Requires Node.js 22.17 or later.

```sh
npx --yes mail-debugger
# or
pnpm dlx mail-debugger
```

This starts:

| Service              | Address                         |
| -------------------- | ------------------------------- |
| SMTP                 | `127.0.0.1:2525`                |
| Web inbox            | `http://127.0.0.1:3000`         |
| REST API             | `http://127.0.0.1:3000/api`     |
| API documentation    | `http://127.0.0.1:3000/swagger` |
| IMAP (with `--imap`) | `127.0.0.1:1143`                |
| MCP (with `--mcp`)   | `http://127.0.0.1:3000/mcp`     |

To keep it in a project, install it as a development dependency:

```sh
npm install --save-dev mail-debugger
npx mail-debugger
```

```sh
pnpm add --save-dev mail-debugger
pnpm exec mail-debugger
```

Stop it with Ctrl+C. Mail is kept in memory unless you add `--persist` or `--data-dir <dir>`.

## Sending mail to it

Configure your application to send through `127.0.0.1:2525`. Without `--auth-user` no authentication is required, and any credentials are accepted. With Nodemailer:

```js
import { createTransport } from 'nodemailer';

const transport = createTransport({ host: '127.0.0.1', port: 2525 });

await transport.sendMail({
  from: 'app@example.test',
  to: 'user@example.test',
  subject: 'Welcome',
  text: 'Hello from the app under test.',
});
```

With `--tls starttls`, add `requireTLS: true`; with `--tls implicit`, add `secure: true` (the port stays 2525 unless you change it). With TLS the server presents a self-signed certificate generated at startup. Either let the client accept it (`tls: { rejectUnauthorized: false }`, for local tests only), or start the server with your own certificate (`--tls-cert`, `--tls-key`) and let the client trust it (`tls: { ca }`).

## Web inbox, REST API and OpenAPI

Open `http://127.0.0.1:3000` for the web inbox. The REST API behind it:

| Method   | Path                                 | Result                                                                                                           |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/health`                        | Status, version, ports, whether storage is persistent, number of emails                                          |
| `GET`    | `/api/emails`                        | Emails newest first: `from`, `to`, `subject`, `since`, `until` filters, `limit` (1 to 200, default 50), `offset` |
| `GET`    | `/api/emails/wait`                   | The first matching email with an id above `afterId`, waiting up to `timeoutMs` (0 to 60000, default 30000)       |
| `GET`    | `/api/emails/:id`                    | One email with addresses, SMTP envelope, headers, bodies and attachments                                         |
| `GET`    | `/api/emails/:id/raw`                | The exact source bytes as `message/rfc822`                                                                       |
| `GET`    | `/api/emails/:id/attachments/:index` | One decoded attachment, `index` counted from 0                                                                   |
| `DELETE` | `/api/emails/:id`                    | Deletes one email                                                                                                |
| `DELETE` | `/api/emails`                        | Deletes all emails                                                                                               |
| `GET`    | `/swagger`, `/swagger/json`          | The interactive API documentation and the OpenAPI document                                                       |

`from`, `to` and `subject` match case-insensitive substrings; `since` and `until` are inclusive UTC bounds (`YYYY-MM-DD` covers the whole day). List responses carry `highWatermark` (the highest id ever assigned) and `mailboxId`, the cursor for `/api/emails/wait`. Ids only grow, also after deleting all mail. Errors are JSON: `{ "error": { "code": "EMAIL_NOT_FOUND", "message": "Email not found" } }`.

## JavaScript and TypeScript client

`mail-debugger/client` is a typed ESM client for the REST API, with no dependencies, for Node.js and browsers:

```js
import { createApiClient } from 'mail-debugger/client';

const mail = createApiClient('http://127.0.0.1:3000');

// Remember where the inbox stands before the test acts.
const { highWatermark = 0, mailboxId } = await mail.listEmails({ limit: 1 });

// ... let your application send the email under test ...

const { data, timedOut } = await mail.waitForEmail({
  afterId: highWatermark,
  mailboxId,
  filter: { to: 'user@example.test' },
  timeoutMs: 10_000,
});
if (timedOut || !data) throw new Error('No email arrived');

const email = await mail.getEmail(data.id);
console.log(email.subject, email.textBody);
const source = await mail.getRawEmail(data.id); // Uint8Array
```

The client also offers `health()`, `getAttachment(id, index)`, `deleteEmail(id)` and `deleteAllEmails()`. Options: `token` (or a function returning it), `headers`, `timeoutMs` (default 10 seconds) and a custom `fetch`; every call accepts an `AbortSignal`. Failures reject with `MailDebuggerApiError` (HTTP status and error code), `MailDebuggerNetworkError` or `MailDebuggerTimeoutError`. Only the `mail-debugger/client` subpath is importable; it opens no connections until you call it.

## Terminal client

```sh
npx mail-debugger cli list                       # newest emails as a table
npx mail-debugger cli list --to user@ --json     # filtered, as JSON
npx mail-debugger cli show 5                     # one email
npx mail-debugger cli wait --subject Welcome     # wait for the next match (exit 1 after 30 s)
npx mail-debugger cli delete 5
npx mail-debugger cli delete-all
npx mail-debugger cli health
npx mail-debugger cli                            # interactive inbox (needs a terminal)
```

Commands connect to `http://127.0.0.1:3000` unless `--api-url` says otherwise, print JSON with `--json`, and exit with 0 on success, 1 on errors and wait timeouts and 2 on usage errors. `wait` takes the filters of `list` plus `--timeout <ms>` (up to one hour) and `--after-id`. A server started with `MAIL_DEBUGGER_API_TOKEN` needs the same variable in the environment of the client. Run `mail-debugger cli --help` for every option. The same client is published alone as [`mail-debugger-cli`](packages/cli/README.md).

The interactive inbox uses the native engine of [Rezi](https://github.com/RtlZeroMemory/Rezi), which ships binaries for Linux (glibc), macOS and Windows on x64 and arm64. On other systems the commands and the web inbox work; the interactive inbox explains that it cannot start.

## IMAP inbox

```sh
npx mail-debugger --imap
```

| `--tls`          | IMAP port | Security                            | Login                                                   |
| ---------------- | --------- | ----------------------------------- | ------------------------------------------------------- |
| `none` (default) | 1143      | none, loopback only                 | `mail-debugger` / `mail-debugger`, or the `--auth-user` |
| `starttls`       | 1143      | STARTTLS, required before any login | same, after the upgrade                                 |
| `implicit`       | 1993      | TLS from the first byte (IMAPS)     | same                                                    |

Mail clients and IMAP libraries see one `INBOX` with every captured message. Reading, flags and deletions are shared with the web inbox, the REST API and every other surface; new SMTP mail appears in IDLE sessions at once. [docs/imap.md](docs/imap.md) has the client setups for Thunderbird, Apple Mail and classic Outlook, the supported commands and the limits.

## MCP for AI agents

```sh
npx mail-debugger --mcp
```

This serves MCP at `http://127.0.0.1:3000/mcp` with six read-only tools: `list_emails`, `search_emails`, `get_email`, `wait_for_email`, `list_email_attachments` and `get_email_attachment`. `--mcp-allow-mutations` adds `delete_email` and `clear_emails`. Register it with your agent, for example:

```sh
claude mcp add --transport http mail-debugger http://127.0.0.1:3000/mcp
codex mcp add mail-debugger --url http://127.0.0.1:3000/mcp
```

Clients that only start local processes use the stdio bridge of an installed package: `mail-debugger mcp --url http://127.0.0.1:3000/mcp`. Tokens, tool schemas, errors and limits are described in [docs/mcp.md](docs/mcp.md).

## Configuration

These options apply to `mail-debugger` (and its explicit form `mail-debugger serve`) and to `mail-debugger-api`; `mail-debugger --help` prints them.

<!-- server-options:start -->

| Option                              | Default                          | Description                                                                                                                                          |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host <address>`                  | `127.0.0.1`                      | Interface for all listeners. Anything but loopback requires --tls, mail credentials and MAIL_DEBUGGER_API_TOKEN                                      |
| `--smtp-port <port>`                | `2525`                           | SMTP port (0 picks a free port)                                                                                                                      |
| `--api-port <port>`                 | `3000`                           | HTTP port of the web inbox, REST API and API docs (0 picks a free port)                                                                              |
| `--imap`                            |                                  | Also serve the captured mail over IMAP: one shared INBOX, read, flag and delete only (login mail-debugger / mail-debugger unless --auth-user is set) |
| `--imap-port <port>`                | `1143, 1993 with --tls implicit` | IMAP port (0 picks a free port)                                                                                                                      |
| `--mcp`                             |                                  | Serve MCP for AI agents at /mcp on the HTTP port, with read-only tools                                                                               |
| `--mcp-allow-mutations`             |                                  | Also offer the MCP tools delete_email and clear_emails                                                                                               |
| `--tls <none\|starttls\|implicit>`  | `none`                           | Encryption of SMTP and IMAP                                                                                                                          |
| `--tls-cert <file>`                 |                                  | PEM certificate, together with --tls-key (default: a generated self-signed certificate)                                                              |
| `--tls-key <file>`                  |                                  | PEM private key of --tls-cert                                                                                                                        |
| `--auth-user <name>`                |                                  | Require SMTP and IMAP authentication as this user; the password comes from MAIL_DEBUGGER_AUTH_PASSWORD or --auth-password-file                       |
| `--auth-password-file <file>`       |                                  | File that contains the password of --auth-user                                                                                                       |
| `--allow-insecure-auth`             |                                  | Allow SMTP and IMAP authentication without TLS (only on a loopback --host)                                                                           |
| `--persist`                         |                                  | Keep mail across restarts in the current directory                                                                                                   |
| `--data-dir <dir>`                  |                                  | Keep mail across restarts in this directory                                                                                                          |
| `--max-message-bytes <bytes>`       | `26214400`                       | Largest accepted message                                                                                                                             |
| `--max-messages <count>`            | `1000`                           | Most messages kept; new mail is refused when reached                                                                                                 |
| `--max-storage-bytes <bytes>`       | `262144000`                      | Most bytes kept; new mail is refused when reached                                                                                                    |
| `--http-allowed-host <host[:port]>` |                                  | Also accept this Host header, e.g. behind a reverse proxy (repeatable)                                                                               |
| `--http-allowed-origin <origin>`    |                                  | Also accept requests from this browser origin (repeatable)                                                                                           |
| `-h`, `--help`                      |                                  | Show this help                                                                                                                                       |
| `--version`                         |                                  | Show the version                                                                                                                                     |

<!-- server-options:end -->

| Variable                      | Effect                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `MAIL_DEBUGGER_API_TOKEN`     | Requires `Authorization: Bearer <token>` on `/api`; the web inbox asks for it               |
| `MAIL_DEBUGGER_MCP_TOKEN`     | Requires a bearer token on `/mcp` (with `--mcp`); the stdio bridge sends it                 |
| `MAIL_DEBUGGER_AUTH_PASSWORD` | Password of `--auth-user` for SMTP and IMAP                                                 |
| `LOG_LEVEL`                   | `debug`, `info`, `warn` or `error`                                                          |
| `NODE_ENV=production`         | Log JSON lines instead of colored text; the line `mail-debugger is ready` carries the ports |

Unknown, repeated or malformed options stop the server with exit code 2; a port in use stops it with exit code 1. Port `0` picks a free port, and the startup log and `GET /api/health` report the bound ones.

### TLS and authentication

`--tls none|starttls|implicit` applies to SMTP and IMAP alike. Without `--tls-cert` and `--tls-key`, a self-signed certificate for `localhost`, `127.0.0.1`, `::1` and the `--host` name is generated at every start. `--auth-user` makes SMTP and IMAP require that account; its password comes from `MAIL_DEBUGGER_AUTH_PASSWORD` or the first line of `--auth-password-file`, never from the command line. Configured credentials are only accepted over TLS unless `--allow-insecure-auth` is given, which works on a loopback `--host` only.

### Reaching it from containers or other machines

Listeners bind `127.0.0.1`. Any other `--host` is refused unless it is protected: TLS, mail credentials, `MAIL_DEBUGGER_API_TOKEN` and, with `--mcp`, `MAIL_DEBUGGER_MCP_TOKEN`. For example, in a container whose ports you publish:

```sh
export MAIL_DEBUGGER_AUTH_PASSWORD='choose-a-password'
export MAIL_DEBUGGER_API_TOKEN='choose-a-token'
npx mail-debugger --host 0.0.0.0 --tls starttls --auth-user dev \
  --http-allowed-host mail-debugger:3000   # the name other containers use
```

Put the HTTP port behind a TLS reverse proxy before you send tokens across a network, and list the names the proxy uses with `--http-allowed-host` and `--http-allowed-origin`: requests with any other `Host`, or from a web page of another origin, get 403.

### Persistence and limits

`--data-dir <dir>` (or `--persist` for the working directory) keeps the mail in `mail-debugger.sqlite` across restarts, together with ids, IMAP UIDs and flags. One server at a time can use a directory (`mail-debugger.lock`). A database of mail-debugger 0.3 is migrated on the first start after a backup copy (`mail-debugger.sqlite.schema1.bak`); message bytes that 0.3 could not store as UTF-8 cannot be restored.

New mail is refused, never dropped silently, once a limit is reached: `--max-message-bytes` (25 MiB) answers 552, `--max-messages` (1000) and `--max-storage-bytes` (250 MiB) answer 452 until mail is deleted. At most 20 SMTP and 20 IMAP connections and 100 pending waits (REST and MCP together) are served at once.

### Upgrading from 0.3

0.4 changes defaults; the [changelog](CHANGELOG.md) lists every change. The ones most likely to matter:

- Node.js 22.17 or later is required.
- Listeners bind `127.0.0.1` instead of all interfaces. Containers and other machines need `--host` and the protections described above.
- Unknown options are errors instead of being ignored.
- API errors are objects (`{ "error": { "code", "message" } }`), and `GET /api/emails` returns at most 50 emails unless `limit` says otherwise.
- `--persist` keeps using `mail-debugger.sqlite` in the working directory and migrates it on the first start.

## Distributions

| Package                                                                | Contents                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`mail-debugger`](https://www.npmjs.com/package/mail-debugger)         | Server with web inbox, REST API, IMAP and MCP; `cli` and `mcp` commands; client  |
| [`mail-debugger-api`](https://www.npmjs.com/package/mail-debugger-api) | The same server without the web inbox, for CI ([README](packages/api/README.md)) |
| [`mail-debugger-cli`](https://www.npmjs.com/package/mail-debugger-cli) | The terminal client alone ([README](packages/cli/README.md))                     |

All three are built from this repository and released together with the same version.

## Troubleshooting

- **`port ... is already in use`**: another process uses port 2525, 3000 or 1143. Choose others with `--smtp-port`, `--api-port` and `--imap-port`, or `0` for free ones.
- **Containers or other machines cannot connect**: the server listens on `127.0.0.1`. See [Reaching it from containers or other machines](#reaching-it-from-containers-or-other-machines).
- **`self-signed certificate` errors**: with `--tls` the generated certificate is not trusted by clients. Accept it in local tests, or use `--tls-cert` and `--tls-key` with a certificate your client trusts.
- **403 from the API or the web inbox**: the `Host` or `Origin` header is not allowed, typically behind a proxy or a custom hostname. Add it with `--http-allowed-host` or `--http-allowed-origin`.
- **401 from the API**: the server runs with `MAIL_DEBUGGER_API_TOKEN`. Send `Authorization: Bearer <token>` (the client's `token` option, the CLI reads the variable).
- **SMTP answers 452 or 552**: a limit is reached. Delete mail or raise `--max-messages`, `--max-storage-bytes` or `--max-message-bytes`.
- **`The data directory is in use`** on startup: `mail-debugger.lock` already exists. The server preserves live, stale and malformed locks. Check that no process uses the directory before manually removing this file; never remove a running server's lock.
- **The interactive inbox does not start**: it needs a terminal and a supported platform; use the commands (`list`, `show`, `wait`) or the web inbox.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and the checks a change has to pass, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md); [docs/architecture.md](docs/architecture.md) gives an overview of the code.

## License

[MIT](LICENSE)
