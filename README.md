# Mail Debugger

Lightweight fake SMTP server that catches emails during development. Inspect, filter, and manage caught emails through a REST API or interactive terminal UI.

## Quick Start

```bash
# Run the server (no install needed)
npx github:defkil/mail-debugger

# Or install as a dev dependency
pnpm add -D github:defkil/mail-debugger
npx mail-debugger
```

This starts an **SMTP server** on port `2525` and an **API server** on port `3000` with Swagger UI at `http://localhost:3000/swagger`.

```bash
# Custom ports with persistent storage
npx mail-debugger --smtp-port 1025 --api-port 8080 --persist
```

### TLS

Standardmäßig läuft der SMTP-Server ohne Verschlüsselung. Über den `--tls` Parameter kann TLS aktiviert werden. Beim Start wird automatisch ein selbstsigniertes Zertifikat erzeugt - Zertifikatsvalidierung im Client muss daher deaktiviert werden.

| Modus | Flag | Beschreibung |
|-------|------|--------------|
| **none** | `--tls none` | Keine Verschlüsselung (Standard) |
| **starttls** | `--tls starttls` | Verbindung startet unverschlüsselt, der Client kann per STARTTLS-Befehl auf TLS upgraden |
| **implicit** | `--tls implicit` | Verbindung ist sofort verschlüsselt (auch als SMTPS bekannt) |

```bash
npx mail-debugger --tls starttls
npx mail-debugger --tls implicit --smtp-port 4650
```

Authentifizierung wird immer akzeptiert - beliebiger Benutzername und Passwort funktionieren.

## CLI Client

```bash
mail-debugger-cli              # Interactive TUI
mail-debugger-cli list         # List all emails
mail-debugger-cli show 5       # Show email details
mail-debugger-cli health       # Server status
```

See [apps/cli/README.md](apps/cli/README.md) for all commands and options.

## SMTP Configuration

Point any SMTP client to `localhost:2525`. Authentication is optional -- any credentials are accepted.

```typescript
import { createTransport } from 'nodemailer';

// Ohne TLS (Standard)
const transport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: false,
});

// Mit STARTTLS (--tls starttls)
const tlsTransport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: false,
  tls: { rejectUnauthorized: false },
});

// Mit Implicit TLS (--tls implicit)
const smtpsTransport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: true,
  tls: { rejectUnauthorized: false },
});
```

## Apps

| App | Description | Docs |
|-----|-------------|------|
| **server** | SMTP server + REST API | [apps/server/README.md](apps/server/README.md) |
| **cli** | Terminal client (TUI + commands) | [apps/cli/README.md](apps/cli/README.md) |

## Development

```bash
pnpm install
pnpm nx serve server              # Dev server with watch
pnpm nx serve cli                 # Dev CLI with watch
pnpm nx run-many -t lint test build typecheck   # All checks
```

## Roadmap

- [ ] Web UI -- Browser-based inbox
- [x] CLI UI -- Terminal-based inbox viewer
- [x] Full SMTP features -- SIZE, STARTTLS, authentication
- [ ] IMAP server -- Email client support
- [ ] MCP support -- Model Context Protocol for AI agents

## License

MIT
