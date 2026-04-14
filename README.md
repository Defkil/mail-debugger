# Mail Debugger

Lightweight fake SMTP server that catches emails during development. Inspect, filter, and manage caught emails through a REST API, web UI, or interactive terminal client.

## Quick Start

```bash
# Run the server (no install needed)
pnpx mail-debugger
```

Or install it once as a dev dependency:

```bash
pnpm add -D mail-debugger
pnpx mail-debugger
```

This starts an **SMTP server** on port `2525` and an **API server** on port `3000` with Swagger UI at `http://localhost:3000/swagger` and a web inbox at `http://localhost:3000`.

```bash
# Custom ports with persistent storage
pnpx mail-debugger --smtp-port 1025 --api-port 8080 --persist
```

### TLS

TLS is disabled by default. Use `--tls` to enable it. A self-signed certificate is generated on startup -- disable certificate validation in your client.

| Mode         | Flag             | Description                                      |
| ------------ | ---------------- | ------------------------------------------------ |
| **none**     | `--tls none`     | No encryption (default)                          |
| **starttls** | `--tls starttls` | Starts unencrypted, client upgrades via STARTTLS |
| **implicit** | `--tls implicit` | Encrypted from the start (SMTPS)                 |

```bash
pnpx mail-debugger --tls starttls
pnpx mail-debugger --tls implicit --smtp-port 4650
```

## CLI Client

The same `mail-debugger` binary also ships the terminal client -- pass `--cli` and everything after it is handed to the CLI parser:

```bash
pnpx mail-debugger --cli                 # Interactive TUI
pnpx mail-debugger --cli list            # List all emails
pnpx mail-debugger --cli show 5          # Show email details
pnpx mail-debugger --cli health          # Server status
```

See [apps/cli/README.md](apps/cli/README.md) for all commands and options.

## Slim API build for CI / E2E

Need only the SMTP + REST API without the bundled web UI? Install [`mail-debugger-api`](https://www.npmjs.com/package/mail-debugger-api) -- same wire protocol, smaller footprint:

```bash
pnpx mail-debugger-api --smtp-port 1025 --api-port 8080
```

## SMTP Configuration

Point any SMTP client to `localhost:2525`. Authentication is optional -- any credentials are accepted.

```typescript
import { createTransport } from 'nodemailer';

// No TLS (default)
const transport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: false,
});

// STARTTLS (--tls starttls)
const tlsTransport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: false,
  tls: { rejectUnauthorized: false },
});

// Implicit TLS (--tls implicit)
const smtpsTransport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: true,
  tls: { rejectUnauthorized: false },
});
```

## Apps

| App        | Description                      | Docs                                           |
| ---------- | -------------------------------- | ---------------------------------------------- |
| **server** | SMTP server + REST API + web UI  | [apps/server/README.md](apps/server/README.md) |
| **cli**    | Terminal client (TUI + commands) | [apps/cli/README.md](apps/cli/README.md)       |

## Development

```bash
pnpm install
pnpm run setup                    # One-time: install husky git hooks
pnpm nx serve server              # Dev server with watch
pnpm nx serve cli                 # Dev CLI with watch
pnpm nx run-many -t lint test build typecheck   # All checks
```

## Releasing

Publishing is fully automated via GitHub Actions with npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no tokens).

```bash
npm version patch          # bumps version + tags commit
git push --follow-tags     # CI builds + publishes to npm
```

## Roadmap

- [x] Web UI -- Browser-based inbox
- [x] CLI UI -- Terminal-based inbox viewer
- [x] Full SMTP features -- SIZE, STARTTLS, authentication
- [ ] IMAP server -- Email client support
- [ ] MCP support -- Model Context Protocol for AI agents

## License

MIT
