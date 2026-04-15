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

The terminal client is available as a separate package [`mail-debugger-cli`](https://www.npmjs.com/package/mail-debugger-cli):

```bash
pnpx mail-debugger-cli                   # Interactive TUI
pnpx mail-debugger-cli list              # List all emails
pnpx mail-debugger-cli show 5            # Show email details
pnpx mail-debugger-cli health            # Server status
```

See [packages/cli/README.md](packages/cli/README.md) for all commands and options.

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

## Packages

| Package               | Description                      | Docs                                             |
| --------------------- | -------------------------------- | ------------------------------------------------ |
| **mail-debugger**     | SMTP server + REST API + web UI  | [apps/server/README.md](apps/server/README.md)   |
| **mail-debugger-cli** | Terminal client (TUI + commands) | [packages/cli/README.md](packages/cli/README.md) |
| **mail-debugger-api** | Slim API build for CI/E2E        | [packages/api/README.md](packages/api/README.md) |

## Roadmap

- [x] Web UI -- Browser-based inbox
- [x] CLI UI -- Terminal-based inbox viewer
- [x] Full SMTP features -- SIZE, STARTTLS, authentication
- [ ] IMAP server -- Email client support
- [ ] MCP support -- Model Context Protocol for AI agents

## License

MIT
