# Security policy

mail-debugger is a development tool. It catches the mail your application sends and shows it to anyone who can reach its ports. Its defaults keep that audience to your own machine; this policy describes what it protects, how to run it safely and how to report a vulnerability.

## Supported versions

Security fixes go into the latest minor release line of `mail-debugger`, `mail-debugger-api` and `mail-debugger-cli`, which are released together with the same version. Currently that is 0.4.x. Older lines receive no fixes; upgrade to the latest release.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **[Report a vulnerability](https://github.com/Defkil/mail-debugger/security/advisories/new)**. If that option is unavailable, email the maintainer at **[mail@olivergruettner.de](mailto:mail@olivergruettner.de)**. Do not open a public issue, pull request or discussion for it.

A useful report contains:

- the version and distribution (`mail-debugger --version`), Node.js version and operating system,
- the command line and relevant environment variables, with secrets replaced,
- the steps or a small script that reproduce the problem, and what an attacker gains.

Do not include real mail, passwords or tokens. The maintainer reviews reports as time allows, keeps you informed privately and agrees on the disclosure with you. There is no bug bounty.

Conduct issues are not security reports; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What the defaults protect

- Every listener (SMTP, HTTP, IMAP) binds `127.0.0.1` unless `--host` names another address.
- A non-loopback `--host` is refused at startup unless SMTP and IMAP use TLS (`--tls starttls` or `--tls implicit`), mail clients must authenticate (`--auth-user` with `MAIL_DEBUGGER_AUTH_PASSWORD` or `--auth-password-file`), the REST API requires `MAIL_DEBUGGER_API_TOKEN`, and MCP (when enabled) requires `MAIL_DEBUGGER_MCP_TOKEN`. `--allow-insecure-auth` only works on loopback.
- HTTP requests must carry an allowed `Host` header and, if present, an allowed `Origin`, which blocks DNS rebinding and other websites in your browser. `--http-allowed-host` and `--http-allowed-origin` add names for a reverse proxy.
- Tokens and passwords are compared in constant time and never logged. Pass them through the environment or a file, not as command-line arguments.
- MCP and IMAP are off unless enabled. MCP offers read-only tools unless `--mcp-allow-mutations` is given.
- Resource limits bound message size, stored mail, connections, waits and output (see the README).

## Captured mail is untrusted

Treat every captured message, header, link and attachment as content from an unknown sender:

- The web inbox shows HTML mail in a sandboxed frame without scripts, forms, network requests or remote images (they load only when you ask). Attachments are downloaded, never opened, and served with safe content types and `X-Content-Type-Options: nosniff`.
- The terminal client replaces control characters of captured mail, so escape sequences in a message cannot act on your terminal.
- MCP tools return mail as data and tell AI agents not to follow instructions found in messages, open their links or run attachments.

## Running it safely

- Keep the loopback default unless another machine or a container really needs access. For Docker or a LAN, use `--host 0.0.0.0` with TLS, credentials and tokens, and put the HTTP port behind a TLS reverse proxy. Never send a bearer token over plain HTTP across a network.
- The development login of the IMAP inbox (`mail-debugger` / `mail-debugger`) and the acceptance of any SMTP credentials without `--auth-user` are deliberate, for local use only.
- With `--persist` or `--data-dir`, all captured mail is stored unencrypted in `mail-debugger.sqlite`. Keep the directory private, do not commit it, and delete it when you no longer need the mail. Without these options mail lives in memory and is gone when the server stops.
- Do not point production systems at mail-debugger: it stores everything it receives and never delivers mail.
