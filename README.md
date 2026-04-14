# Mail Debugger

A lightweight fake SMTP server that catches emails during development. Inspect, filter, and manage caught emails through a REST API with OpenAPI/Swagger documentation.

## Features

- **SMTP Server** -- Catches all emails sent to it (no authentication required)
- **REST API** -- List, filter, view, and delete caught emails
- **SQLite Storage** -- In-memory by default, optional file persistence
- **OpenAPI/Swagger** -- Interactive API documentation at `/swagger`
- **Zero Config** -- Works out of the box with sensible defaults

## Installation

Install as a dev dependency in your project directly from GitHub:

```bash
# npm
npm install --save-dev github:defkil/mail-debugger

# pnpm
pnpm add -D github:defkil/mail-debugger

# yarn
yarn add -D github:defkil/mail-debugger
```

## Quick Start

```bash
# Run directly with npx (no install needed)
npx github:defkil/mail-debugger

# Or if installed as a dependency
npx mail-debugger
```

This starts:
- **SMTP server** on port `2525`
- **API server** on port `3000`
- **Swagger UI** at `http://localhost:3000/swagger`

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--smtp-port <port>` | `2525` | SMTP server port |
| `--api-port <port>` | `3000` | REST API server port |
| `--persist` | `false` | Enable persistent SQLite storage (file: `mail-debugger.sqlite`) |

```bash
# Custom ports with persistent storage
npx github:defkil/mail-debugger --smtp-port 1025 --api-port 8080 --persist
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/emails` | List all emails (supports filtering) |
| `GET` | `/api/emails/:id` | Get full email details |
| `DELETE` | `/api/emails/:id` | Delete a single email |
| `DELETE` | `/api/emails` | Delete all emails |
| `GET` | `/api/health` | Health check and server info |
| `GET` | `/swagger` | OpenAPI/Swagger UI |

### Filtering Emails

`GET /api/emails` supports the following query parameters:

| Parameter | Description |
|-----------|-------------|
| `from` | Filter by sender address (partial match) |
| `to` | Filter by recipient address (partial match) |
| `subject` | Filter by subject (partial match) |
| `since` | Filter emails received after this datetime |
| `until` | Filter emails received before this datetime |

Example: `GET /api/emails?from=alice&subject=welcome`

## Usage in Local Development

Configure your application to send emails to the Mail Debugger SMTP server:

### Node.js (Nodemailer)

```typescript
import { createTransport } from 'nodemailer';

const transport = createTransport({
  host: 'localhost',
  port: 2525,
  secure: false,
  tls: { rejectUnauthorized: false },
});

await transport.sendMail({
  from: 'app@example.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our app</h1>',
});
```

### Generic SMTP Configuration

Point any SMTP client to:
- **Host:** `localhost`
- **Port:** `2525` (or your custom port)
- **Authentication:** None required
- **TLS/SSL:** Disabled

## Usage in E2E Tests

### Setup Pattern

```typescript
import { spawn, type ChildProcess } from 'child_process';

let serverProcess: ChildProcess;

// Start server before tests
beforeAll(async () => {
  serverProcess = spawn('npx', [
    'mail-debugger',
    '--smtp-port', '2526',
    '--api-port', '3001',
  ], { stdio: 'pipe', shell: true });

  // Wait for server to be ready
  await waitForHealth('http://localhost:3001/api/health');
});

// Clean up after tests
afterAll(() => {
  serverProcess.kill('SIGTERM');
});

// Clear emails between tests
beforeEach(async () => {
  await fetch('http://localhost:3001/api/emails', { method: 'DELETE' });
});
```

### Test Example

```typescript
import { createTransport } from 'nodemailer';

it('should send a welcome email', async () => {
  // Trigger your application logic that sends an email
  await myApp.registerUser('user@example.com');

  // Verify the email was sent
  const res = await fetch('http://localhost:3001/api/emails?subject=Welcome');
  const { data } = await res.json();

  expect(data).toHaveLength(1);
  expect(data[0].to).toContain('user@example.com');
});
```

## Development

```bash
# Install dependencies
pnpm install

# Start development server (with watch mode)
pnpm nx serve server

# Run unit tests
pnpm nx test server

# Run e2e tests
pnpm nx e2e server-e2e

# Build for production
pnpm nx build server

# Lint
pnpm nx lint server

# Type check
pnpm nx typecheck server

# Run all checks
pnpm nx run-many -t lint test build typecheck
```

## Architecture

```
apps/server/src/
  main.ts              -- Entry point, wires all components
  config.ts            -- CLI argument parsing
  types.ts             -- Shared TypeScript interfaces
  db/
    schema.ts          -- SQLite table definitions
    connection.ts      -- Database factory (in-memory / persistent)
    email-repository.ts -- CRUD operations for emails
  smtp/
    smtp-server.ts     -- SMTP server (catches incoming emails)
  parser/
    email-parser.ts    -- Raw email -> structured data
  api/
    app.ts             -- ElysiaJS application with Swagger
    routes/
      emails.ts        -- Email management endpoints
      health.ts        -- Health check endpoint
```

## Roadmap

- [ ] **Web UI** -- Browser-based inbox for viewing caught emails
- [ ] **CLI UI** -- Terminal-based inbox viewer
- [ ] **Full SMTP features** -- SIZE, STARTTLS, authentication
- [ ] **IMAP server** -- Allow email clients to connect and read caught emails
- [ ] **MCP support** -- Model Context Protocol server for AI agent integration

## License

MIT
