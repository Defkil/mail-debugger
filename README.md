# Mail Debugger

Lightweight fake SMTP server that catches emails during development. Inspect, filter, and manage caught emails through a REST API or interactive terminal UI.

## Quick Start

```bash
# Run the server (no install needed)
pnpx github:defkil/mail-debugger
```

Or install it once as a dev dependency and run it by name:

```bash
pnpm add -D github:defkil/mail-debugger
pnpx mail-debugger
```

This starts an **SMTP server** on port `2525` and an **API server** on port `3000` with Swagger UI at `http://localhost:3000/swagger`.

```bash
# Custom ports with persistent storage
pnpx github:defkil/mail-debugger --smtp-port 1025 --api-port 8080 --persist
```

### TLS

TLS is disabled by default. Use `--tls` to enable it. A self-signed certificate is generated on startup -- disable certificate validation in your client.

| Mode         | Flag             | Description                                      |
| ------------ | ---------------- | ------------------------------------------------ |
| **none**     | `--tls none`     | No encryption (default)                          |
| **starttls** | `--tls starttls` | Starts unencrypted, client upgrades via STARTTLS |
| **implicit** | `--tls implicit` | Encrypted from the start (SMTPS)                 |

```bash
pnpx github:defkil/mail-debugger --tls starttls
pnpx github:defkil/mail-debugger --tls implicit --smtp-port 4650
```

## CLI Client

```bash
pnpm dlx -p github:defkil/mail-debugger mail-debugger-cli              # Interactive TUI
pnpm dlx -p github:defkil/mail-debugger mail-debugger-cli list         # List all emails
pnpm dlx -p github:defkil/mail-debugger mail-debugger-cli show 5       # Show email details
pnpm dlx -p github:defkil/mail-debugger mail-debugger-cli health       # Server status
```

See [apps/cli/README.md](apps/cli/README.md) for all commands and options.

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
| **server** | SMTP server + REST API           | [apps/server/README.md](apps/server/README.md) |
| **cli**    | Terminal client (TUI + commands) | [apps/cli/README.md](apps/cli/README.md)       |

## Development

```bash
pnpm install
pnpm nx serve server              # Dev server with watch
pnpm nx serve cli                 # Dev CLI with watch
pnpm nx run-many -t lint test build typecheck   # All checks
```

## Roadmap

- [x] Web UI -- Browser-based inbox
- [x] CLI UI -- Terminal-based inbox viewer
- [x] Full SMTP features -- SIZE, STARTTLS, authentication
- [ ] IMAP server -- Email client support
- [ ] MCP support -- Model Context Protocol for AI agents

## License

MIT
