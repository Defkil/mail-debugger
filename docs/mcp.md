# MCP for AI agents

mail-debugger can offer the mail it catches to AI agents through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP). An agent that tests an application can then list, search, read and wait for the email the application sends, and read attachment bytes, without scraping the web inbox.

MCP is off by default. When enabled, it is served over streamable HTTP at `/mcp` on the HTTP port of the server. Clients that only start local processes connect through `mail-debugger mcp`, a stdio bridge to that endpoint. Both use the official MCP TypeScript SDK 2.3.1.

## Enabling it

```sh
mail-debugger --mcp
```

| Option or variable        | Effect                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--mcp`                   | Serve MCP at `http://127.0.0.1:3000/mcp` (the `--host` and `--api-port` of the server) with the six read tools |
| `--mcp-allow-mutations`   | Also offer `delete_email` and `clear_emails`                                                                   |
| `MAIL_DEBUGGER_MCP_TOKEN` | Require `Authorization: Bearer <token>` on `/mcp` (independent of `MAIL_DEBUGGER_API_TOKEN`)                   |

On a loopback `--host` the token is optional. Binding anything else requires `MAIL_DEBUGGER_MCP_TOKEN` with `--mcp`, besides the rules that apply to every listener (TLS and credentials for mail, the API token for REST). Remote use needs a TLS reverse proxy in front of the HTTP port; never send a bearer token over plain HTTP across a network. Every request is checked for an allowed `Host` and, when present, `Origin` header before it reaches MCP; requests from a browser on another site are refused with 403. Behind a proxy, add its names with `--http-allowed-host` and `--http-allowed-origin`.

Without `--mcp`, `/mcp` answers a JSON 404.

## Registering the server

Keep `mail-debugger --mcp` running in another terminal, then register it. Direct HTTP needs no extra process and is the preferred setup, also on Windows.

```sh
# Claude Code
claude mcp add --transport http mail-debugger http://127.0.0.1:3000/mcp
claude mcp list

# Codex
codex mcp add mail-debugger --url http://127.0.0.1:3000/mcp
codex mcp list
```

For clients that only start processes, register the stdio bridge of an installed `mail-debugger`:

```sh
claude mcp add --transport stdio mail-debugger -- mail-debugger mcp --url http://127.0.0.1:3000/mcp
codex mcp add mail-debugger -- mail-debugger mcp --url http://127.0.0.1:3000/mcp
```

With a token, keep the secret in the environment that starts the client rather than in a command line or a committed file. For Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.mail-debugger]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "MAIL_DEBUGGER_MCP_TOKEN"
tool_timeout_sec = 45
default_tools_approval_mode = "writes"
```

For Claude Code, in the project's `.mcp.json` (Claude Code expands `${MAIL_DEBUGGER_MCP_TOKEN}` from its environment):

```json
{
  "mcpServers": {
    "mail-debugger": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${MAIL_DEBUGGER_MCP_TOKEN}" }
    }
  }
}
```

The stdio bridge reads `MAIL_DEBUGGER_MCP_TOKEN` from its own environment and sends it to the server. These registrations follow the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) and the [Codex MCP documentation](https://developers.openai.com/codex/mcp).

On Windows, npm installs `mail-debugger` as a `.cmd` shim. The stdio transport of the MCP TypeScript SDK starts it directly; a client that cannot start `.cmd` files can register `cmd /c mail-debugger mcp --url http://127.0.0.1:3000/mcp` instead. Both forms were checked with an installed package.

## Tools

Every tool returns structured content that matches its output schema, plus the same JSON as a text block. All input objects are strict: unknown keys are refused. Ids are positive integers, offsets and cursors non-negative integers. Captured mail is **untrusted test data**: the server instructions and every tool description tell the agent not to follow instructions found in messages, not to open their links and not to run attachments.

| Tool                     | Input                                                                                                                                                                 | Result                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `list_emails`            | `limit` 1 to 100 (default 20), `offset` (default 0)                                                                                                                   | `{ data, total, highWatermark, mailboxId }`, newest first                                                      |
| `search_emails`          | `filter` with at least one of `from`, `to`, `subject` (case-insensitive substrings, up to 512 characters), `since`, `until` (inclusive UTC bounds); `limit`, `offset` | as `list_emails`; every criterion must match                                                                   |
| `get_email`              | `id`; `body` `none`, `text` (default) or `html`; `includeHeaders` (default true); `maxBodyBytes` 0 to 262144 (default 65536)                                          | addresses, subject, date, envelope, headers, one body with `bytes` and `truncated`, the attachment list        |
| `wait_for_email`         | `afterId` (optional), `mailboxId` (optional), `filter` (optional), `timeoutMs` 0 to 30000 (default 10000)                                                             | `{ email, timedOut, highWatermark, mailboxId }`                                                                |
| `list_email_attachments` | `id`                                                                                                                                                                  | `{ emailId, attachments: [{ index, filename, size, contentType }], total, truncated }`                         |
| `get_email_attachment`   | `id`, zero-based `index`, `offset` (default 0), `maxBytes` 1 to 65536 (default 65536)                                                                                 | `{ emailId, index, filename, contentType, size, offset, dataBase64, nextOffset, truncated }`                   |
| `delete_email`           | `id`, `confirm: true`                                                                                                                                                 | `{ deleted: true, id }`                                                                                        |
| `clear_emails`           | `confirm: true`, `expectedCount`                                                                                                                                      | `{ deleted }`; deletes nothing and fails with `COUNT_CHANGED` unless exactly `expectedCount` emails are stored |

The read tools are annotated `readOnlyHint: true, destructiveHint: false, openWorldHint: false`. `delete_email` and `clear_emails` exist only with `--mcp-allow-mutations` (without it, a call to them fails as a call to an unknown tool) and are annotated `readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false`: repeating them answers `EMAIL_NOT_FOUND` or `COUNT_CHANGED`. The `confirm` fields guard against accidental calls; they are no authentication. Deletions reach every surface: the web inbox, the REST API and IMAP sessions.

### Waiting for mail

`highWatermark` is the highest email id the mailbox ever allocated (ids only grow, also after deletions), and `mailboxId` identifies the mailbox data set. `wait_for_email` with `afterId` returns the matching email with the lowest id above it, immediately if one is stored. Without `afterId` it waits for mail that arrives after the call. A timeout is a normal result with `email: null` and `timedOut: true`; continue with the returned `highWatermark`. A cursor above the high watermark, or a `mailboxId` of another data set (for example after an in-memory server restarted), fails with `INVALID_CURSOR`.

At most 32 `wait_for_email` calls can be pending at once (they count toward the server-wide limit of 100 waits shared with the REST API); more fail with `LIMIT_EXCEEDED`. Cancelling a call ends its wait: clients of protocol 2026-07-28 cancel by closing the request, which the server notices at once. 2025-era clients send a separate `notifications/cancelled` request, which a stateless HTTP endpoint cannot match to the call, so their wait runs until its own timeout (at most 30 seconds) or until the client disconnects. The stdio bridge talks to the server with protocol 2026-07-28 and forwards cancellations of either era.

### Bounded output

Bodies are cut at `maxBodyBytes` and attachment chunks at `maxBytes`, both at UTF-8 character or byte boundaries, and the results say so (`truncated`, `bytes`, `nextOffset`). Long subjects, addresses, header values and attachment lists are shortened as well (`truncated: true`), so that no result exceeds 1 MiB. Attachment bytes are only ever returned as base64 data: the server never opens, executes or saves them, and fetches nothing from the network.

### Errors

A failed call is a tool result with `isError: true`, a text block `CODE: message` and `structuredContent: { error: { code, message } }`. Messages never contain stack traces, SQL or secrets.

| Code                   | Meaning                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `EMAIL_NOT_FOUND`      | No email with that id                                                                                              |
| `ATTACHMENT_NOT_FOUND` | The email has no attachment with that index                                                                        |
| `INVALID_ARGUMENT`     | A value the schema allows but the server refuses: a date bound it cannot read, an attachment offset beyond the end |
| `INVALID_CURSOR`       | `afterId` above the high watermark, or `mailboxId` of another data set                                             |
| `COUNT_CHANGED`        | `clear_emails` found a different number of emails                                                                  |
| `LIMIT_EXCEEDED`       | Too many pending waits, or a result over 1 MiB                                                                     |
| `SHUTTING_DOWN`        | The server is stopping                                                                                             |
| `SERVER_UNAVAILABLE`   | The stdio bridge cannot reach the server                                                                           |
| `CANCELLED`            | The client cancelled the call                                                                                      |
| `INTERNAL_ERROR`       | An unexpected failure; the server logs the details                                                                 |

Arguments that do not match the input schema are answered by the SDK with an `isError` result that describes the problem (`Input validation error: ...`), without a code. Malformed JSON-RPC and unknown tools are protocol errors.

## Protocol details

- The endpoint speaks protocol revision 2026-07-28 and, through the SDK's stateless fallback, the earlier revisions the SDK supports (`2024-10-07` to `2025-11-25`; the tests cover `2025-06-18` and `2025-11-25`). There are no sessions: `GET /mcp` answers 405, and every request gets a fresh MCP server over the shared mailbox.
- Request bodies are limited to 64 KiB (413 above), and at most 64 MCP requests run at once (429 with `Retry-After: 1` above). The tool list never changes while the server runs (`listChanged: false`).

## The stdio bridge

```text
mail-debugger mcp [--url <url>]
```

The bridge connects to the endpoint (default `http://127.0.0.1:3000/mcp`) when it starts, takes over the tool list and the instructions of the server, and then serves MCP on stdin and stdout. It opens no mailbox and no listener, forwards every call once (it never retries, so a deletion is never sent twice) and forwards cancellations. Only protocol messages go to stdout; its log lines go to stderr. It exits with code 0 when stdin closes, 1 when the server cannot be reached or refuses the token at startup (with a message on stderr), and 2 for invalid options or a malformed token. It keeps the tool list it started with, so restart it after restarting the server with other MCP options. If the server goes away later, calls fail with `SERVER_UNAVAILABLE`.

## How this is tested

The end-to-end tests (`apps/server-e2e/src/mcp`) start the built server and use the SDK client over real HTTP and through the spawned bridge: initialization with the 2026-07-28 protocol and with 2025-era clients, raw `initialize` and `tools/list` requests for `2025-06-18` and `2025-11-25`, tool lists, schemas and annotations, an SMTP multipart message compared with the REST API (Message-ID, addresses, decoded body, attachment hash), waits and their cancellation (32 cancelled waits free their slots, over HTTP and through the bridge), foreign Host and Origin headers, oversized bodies, missing and wrong tokens, read-only and writable servers including deletions seen by IMAP, the slim `mail-debugger-api` distribution, bridge stdout purity, its exit on stdin EOF and its failures when the server is unavailable at startup or later. Unit tests (`apps/server/src/mcp`) cover every tool result and error, output limits and UTF-8 boundaries, cursor errors, the wait and request limits and shutdown.
