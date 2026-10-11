# mail-debugger-api

[![npm](https://img.shields.io/npm/v/mail-debugger-api)](https://www.npmjs.com/package/mail-debugger-api)
[![License: MIT](https://img.shields.io/npm/l/mail-debugger-api)](LICENSE)

The slim build of [mail-debugger](https://github.com/Defkil/mail-debugger#readme) for CI and end-to-end tests: the same SMTP capture, REST API, IMAP inbox and MCP endpoint, without the web inbox and the terminal client. The server is one bundled file; its only runtime dependencies are sql.js and pino.

> **For development and testing only.** It accepts every message and shows it to anyone who can reach its ports. By default all listeners bind `127.0.0.1`.

## Usage

Requires Node.js 22.17 or later.

```sh
npx --yes mail-debugger-api
```

SMTP listens on `127.0.0.1:2525`, the REST API on `http://127.0.0.1:3000/api` with its documentation at `/swagger`. With `--imap`, IMAP listens on port 1143; with `--mcp`, MCP is served at `/mcp`.

In a CI job, start it in the background and wait until it answers:

```sh
npx --yes mail-debugger-api &
curl --silent --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/api/health
```

Then let the application under test send to `127.0.0.1:2525` and read the mail over the REST API, for example `GET /api/emails?to=user@example.test` or `GET /api/emails/wait?afterId=0&to=user@example.test`. The typed JavaScript client is part of the full package: `npm install --save-dev mail-debugger` and `import { createApiClient } from 'mail-debugger/client'`.

## Options

<!-- server-options:start -->

| Option                              | Default                          | Description                                                                                                                                          |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host <address>`                  | `127.0.0.1`                      | Interface for all listeners. Anything but loopback requires --tls, mail credentials and MAIL_DEBUGGER_API_TOKEN                                      |
| `--smtp-port <port>`                | `2525`                           | SMTP port (0 picks a free port)                                                                                                                      |
| `--api-port <port>`                 | `3000`                           | HTTP port of the REST API and API docs (0 picks a free port)                                                                                         |
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

`MAIL_DEBUGGER_API_TOKEN`, `MAIL_DEBUGGER_MCP_TOKEN`, `MAIL_DEBUGGER_AUTH_PASSWORD`, `LOG_LEVEL` and `NODE_ENV=production` work as in mail-debugger. The [mail-debugger README](https://github.com/Defkil/mail-debugger#readme) describes the REST API, TLS, authentication, persistence, limits and troubleshooting; [docs/imap.md](https://github.com/Defkil/mail-debugger/blob/main/docs/imap.md) and [docs/mcp.md](https://github.com/Defkil/mail-debugger/blob/main/docs/mcp.md) cover IMAP and MCP.

## Related packages

- [`mail-debugger`](https://www.npmjs.com/package/mail-debugger): the full server with the web inbox, the `cli` and `mcp` commands and the client.
- [`mail-debugger-cli`](https://www.npmjs.com/package/mail-debugger-cli): the terminal client alone.

All three are released together with the same version.

## License

[MIT](LICENSE)
