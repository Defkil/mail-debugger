# IMAP inbox

mail-debugger can serve the mail it catches over IMAP, so a desktop mail client or an IMAP library can read it. This is a **development inbox**, not a mail account: there is exactly one mailbox, `INBOX`, and it only receives mail through SMTP. Clients can read messages, change flags and delete messages; they cannot create folders, upload messages or copy them anywhere.

The protocol engine is [ImapKit](https://github.com/postalsys/imapkit) 5.0.1. mail-debugger keeps its own mailbox as the source of truth and connects it to ImapKit, so IMAP, the web inbox, the REST API, the JavaScript client, the terminal client and MCP always show the same mail.

## Enabling it

```sh
mail-debugger --imap
```

IMAP is off unless `--imap` is given. It uses the same `--host` (default `127.0.0.1`) and the same `--tls` mode as SMTP, and with TLS the same certificate.

| `--tls`          | Default IMAP port | Connection security                 | Login before TLS                  |
| ---------------- | ----------------- | ----------------------------------- | --------------------------------- |
| `none` (default) | 1143              | None, loopback only                 | Yes, with the development login   |
| `starttls`       | 1143              | STARTTLS, required before any login | Only with `--allow-insecure-auth` |
| `implicit`       | 1993              | TLS from the first byte (IMAPS)     | Not applicable                    |

`--imap-port` chooses another port (`0` picks a free one; the startup log and `GET /api/health` report the actual port as `imapPort`).

### Login

| Setup                                                   | User name                | Password                                           |
| ------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| No `--auth-user` (local development)                    | `mail-debugger`          | `mail-debugger`                                    |
| `--auth-user <name>` with `MAIL_DEBUGGER_AUTH_PASSWORD` | the configured user name | the configured password (also required by SMTP)    |
| `--auth-user <name>` with `--auth-password-file <file>` | the configured user name | the first line of the file (also required by SMTP) |

Credentials are compared exactly and in constant time. Configured credentials never travel in plain text unless you say so: `--imap --auth-user ...` with `--tls none` is refused at startup unless `--allow-insecure-auth` is given, and with `--tls starttls` the server advertises `LOGINDISABLED` and answers `LOGIN` and every `AUTHENTICATE` with `NO [PRIVACYREQUIRED]` until the client has run `STARTTLS`. Binding anything but loopback (`--host`) requires TLS, configured credentials and the API token, as for SMTP.

`LOGIN` and `AUTHENTICATE PLAIN` (with or without an initial response, `SASL-IR`) are supported. Wrong credentials get `NO [AUTHENTICATIONFAILED]`, a PLAIN authorization identity that differs from the user name gets `NO [AUTHORIZATIONFAILED]`, and malformed input gets `BAD`. No other mechanism is offered.

### Trusting the certificate

Without `--tls-cert`/`--tls-key` the server generates a self-signed certificate for `localhost`, `127.0.0.1`, `::1` and the `--host` name at every start, so clients must either skip verification for this local server or be given your own certificate: start with `--tls-cert cert.pem --tls-key key.pem` and add `cert.pem` (or its CA) to the client's trusted certificates.

## Connecting a mail client

These settings follow the standard manual IMAP setup of each client. They are targets of the protocol tests below, **not** tested by driving the clients themselves.

- **Thunderbird**: add a mail account with manual configuration; incoming server IMAP, host `127.0.0.1`, the port and security from the table above, normal password authentication, user name and password from the login table. In the account settings, keep sent mail, drafts and templates in Local Folders, because the server cannot store them.
- **Apple Mail**: add an "Other Mail Account" and enter the IMAP server manually with the same values; turn off storing sent messages, drafts and deleted messages on the server.
- **Classic desktop Outlook** (Windows): add an IMAP account with advanced/manual setup and the same values; let Outlook keep sent items and drafts in a local data file.

New Outlook, Outlook on the web, mobile apps and other clients that synchronise accounts through a provider's cloud connect from that cloud, not from your machine, so they cannot reach a server on `127.0.0.1`.

## What the server supports

Capabilities: `IMAP4rev1 ID IDLE NAMESPACE UNSELECT UIDPLUS LITERAL-`, plus `AUTH=PLAIN SASL-IR` while a login is possible, and `STARTTLS LOGINDISABLED` before the upgrade in `starttls` mode. Nothing else is advertised (no IMAP4rev2, MOVE, CONDSTORE, QRESYNC, SPECIAL-USE, SORT, THREAD, ESEARCH, BINARY, COMPRESS, QUOTA, ACL or UTF8=ACCEPT).

- **Mailboxes**: `LIST` and `LSUB` show only `INBOX` (attribute `\Noinferiors`); `NAMESPACE` answers `(("" "/")) NIL NIL`. `INBOX` is case-insensitive. `SELECT` opens it read-write, `EXAMINE` read-only. `STATUS` reports `MESSAGES`, `RECENT`, `UIDNEXT`, `UIDVALIDITY` and `UNSEEN`. Other names answer `NO [NONEXISTENT]`.
- **Reading**: `FETCH` and `UID FETCH` support the `ALL`/`FAST`/`FULL` macros, `UID`, `FLAGS`, `INTERNALDATE`, `RFC822.SIZE`, `ENVELOPE`, `BODY`, `BODYSTRUCTURE`, `RFC822`, `RFC822.HEADER`, `RFC822.TEXT`, `BODY[...]` and `BODY.PEEK[...]` with `HEADER`, `TEXT`, `HEADER.FIELDS (...)`, `HEADER.FIELDS.NOT (...)`, part numbers, `MIME` and partial ranges `<offset.length>`. Sources are served as received; `RFC822.SIZE` and every literal count octets.
- **\Seen**: `BODY[...]`, `RFC822` and `RFC822.TEXT` set `\Seen` in a mailbox opened with `SELECT`; `BODY.PEEK[...]` and anything in an `EXAMINE` session never do.
- **Searching**: `SEARCH` and `UID SEARCH` support the RFC 3501 keys (flags, addresses, `SUBJECT`, `HEADER`, `BODY`, `TEXT`, dates, sizes, sequence and UID sets, `AND`/`OR`/`NOT`), with `CHARSET` US-ASCII or UTF-8; other charsets get `NO [BADCHARSET (US-ASCII UTF-8)]`.
- **Flags**: `STORE` and `UID STORE` set, add and remove `\Seen \Answered \Flagged \Deleted \Draft` and keywords, also with `.SILENT`. `\Recent` belongs to the session and cannot be stored. Other sessions with `INBOX` open are told about every change.
- **Deleting**: `EXPUNGE`, `UID EXPUNGE` and `CLOSE` remove `\Deleted` messages from the mailbox itself, so they also disappear from the web inbox, the REST API and every other surface. Deleting mail there sends `EXPUNGE` to IMAP sessions; new SMTP mail sends `EXISTS` (immediately to clients in `IDLE`). `UNSELECT`, `LOGOUT` and a dropped connection never expunge.
- **Subscriptions**: `SUBSCRIBE`/`UNSUBSCRIBE INBOX` are stored with the mailbox.
- **CHECK** writes pending changes of a persistent mailbox (`--persist`/`--data-dir`) to disk before it answers.
- **Refused operations**, with truthful response codes: `CREATE` (`NO [CANNOT]`, `NO [ALREADYEXISTS]` for INBOX), `DELETE` and `RENAME` of INBOX (`NO [CANNOT]`; other names `NO [NONEXISTENT]`), `APPEND`, `COPY` and `UID COPY` to INBOX (`NO [NOPERM]`; other targets `NO [TRYCREATE]`). An `APPEND` literal is refused before the client sends it. Unknown commands such as `MOVE` get `BAD`.

### Identity and persistence

UIDs never change and are never reused, not even after the inbox is cleared: the next message always gets a higher UID. The `UIDVALIDITY` value belongs to the mailbox data set. With `--persist` or `--data-dir`, UIDs, `UIDVALIDITY`, `UIDNEXT`, flags and the INBOX subscription survive restarts; an in-memory server starts a new data set every time. A new data set receives a random nonzero 32-bit `UIDVALIDITY`, independent of the restart time. The highest message UID is 4,294,967,294; the last 32-bit value, 4,294,967,295, is reserved for `UIDNEXT`. Once `UIDNEXT` reaches that value, the data set refuses new mail with `STORAGE_FULL`, even after mail is deleted, rather than overflowing or reusing UIDs.

Replacing a data set does not guarantee a greater `UIDVALIDITY`, and random 32-bit values can theoretically collide. This restricted development profile does not preserve the identity history of discarded data sets. Use `--data-dir` when reconnecting clients need persistent mailbox identity and cache continuity.

The `\Recent` flag is session state: after a restart the first session that selects `INBOX` sees every message as recent.

## Limits

| Limit                                                        | Value                                                  | Answer                                     |
| ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------ |
| Sessions at once                                             | 20                                                     | `* BYE [UNAVAILABLE] Too many connections` |
| TCP connections, including unfinished TLS handshakes         | 40                                                     | additional connections are closed          |
| Time to log in after connecting                              | 30 seconds (also the TLS handshake)                    | `* BYE Autologout; idle for too long`      |
| Inactivity of a logged-in session                            | 30 minutes (clients re-issue `IDLE` within 29 minutes) | `* BYE Autologout; idle for too long`      |
| Command line                                                 | 1 MiB                                                  | `BAD`                                      |
| Literal before login / after login                           | 64 KiB / 64 KiB                                        | `BAD Literal too large`, before it is sent |
| Non-synchronising literal (`LITERAL-`)                       | 4096 octets                                            | `BAD [TOOBIG]`                             |
| Data items in one `FETCH`                                    | 64                                                     | `NO [LIMIT]`                               |
| Response for one message in a `FETCH`                        | output budget minus 4 MiB (54 MiB by default)          | `NO [LIMIT]`                               |
| Pending output of a session                                  | 2 x `--max-message-bytes` + 8 MiB (58 MiB by default)  | the connection is closed                   |
| Output that does not drain                                   | 30 seconds                                             | the connection is closed                   |
| Pipelined commands waiting for an earlier command            | 64 commands / 4 MiB of input                           | `* BYE`; reconnect                         |
| Queued mailbox updates for a selected session                | 1024 updates                                           | `* BYE`; reconnect and select INBOX again  |
| Deleted sources retained for a session's old message numbers | output budget (counting two bytes per source octet)    | `* BYE`; reconnect and select INBOX again  |
| Flags per message, keyword length                            | 32 flags, 64 characters                                | `NO [LIMIT]`                               |
| Keywords in the mailbox (including old)                      | 256                                                    | `NO [LIMIT]`                               |

A `FETCH` that produces more than 4 MiB is answered in batches: each batch is sent once the client has read most of the previous output, so a client can fetch the whole mailbox at the size limit while the server's memory stays bounded. A client that stops reading is disconnected instead of growing the server's memory. The mailbox limits (`--max-messages`, `--max-storage-bytes`, `--max-message-bytes`) apply as for every other surface.

A selected client that stops requesting updates can retain expunged sources to preserve its old message numbers. Those sources and its pending updates are bounded separately from the current mailbox. Clients in `IDLE` receive updates immediately and ordinarily do not accumulate this queue. Shutdown closes every TCP connection within the configured grace period, including clients that never finish a TLS handshake.

ImapKit keeps the message sources it serves in memory, next to the stored mailbox. At the default limits, a mailbox filled to the 250 MiB storage limit used about 290 MiB more private memory with `--imap` than without it on Windows ARM64 (Node 26), and about 1 GiB at the peak while a client fetched the whole mailbox.

## Protocol details worth knowing

- Messages whose lines end with a bare LF are served with CRLF line ends, as IMAP requires; sizes and sections count the CRLF form. The REST API (`GET /api/emails/:id/raw`) returns the exact bytes SMTP received.
- A session keeps the message numbers it knows until it is told about an expunge (RFC 2180): a `FETCH`, `STORE` or `SEARCH` that runs while another surface deleted a message still sees it and completes with `[EXPUNGEISSUED]`; the `EXPUNGE` follows with the next command that may report it.
- `STATUS INBOX` while `INBOX` is selected works but carries `[CLIENTBUG]`, as RFC 9051 suggests.

## How this is tested

The end-to-end tests (`apps/server-e2e/src/imap`) start the built server and use [ImapFlow](https://github.com/postalsys/imapflow) 2.4.0 and raw IMAP transcripts:

- capabilities in every TLS mode and their change after `STARTTLS`; refused plaintext logins; configured, wrong and development credentials; trusted and untrusted certificates;
- an SMTP multipart message with a UTF-8 subject and a binary attachment, compared byte for byte with the REST API: source, size, envelope, body structure, decoded parts and the attachment;
- `\Seen` with `BODY[]`, `BODY.PEEK[]` and `EXAMINE`; searches; UID ranges and `*`; an empty INBOX; UTF-8 search;
- flag changes and expunges seen by a second session, stable UIDs while sequence numbers shift, `EXPUNGEISSUED` after a REST deletion, `IDLE` notifications for SMTP mail and REST deletions, UIDs after a clear, and the same surviving mail on the REST API, the JavaScript client and the terminal client;
- restarts with `--data-dir` (UIDVALIDITY, UIDNEXT, flags, subscription), a new in-memory data set, and mail migrated from mail-debugger 0.3;
- refused mailbox operations and uploads, literals, fragments, quoting, line endings, malformed commands, the session limit and BYE on shutdown, also from the slim `mail-debugger-api` distribution.

Unit tests (`apps/server/src/imap`) cover what needs fault injection or small limits: flag, `\Seen` and expunge changes that cannot be stored are rolled back for every session and answered `NO [SERVERBUG]`; batched `FETCH` output under a small budget, with mail arriving and leaving between batches; slow readers; timeouts; literal and keyword limits.

Desktop clients are not driven by these tests; the client section above describes standard manual setups.
