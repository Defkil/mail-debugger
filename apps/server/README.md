# @mail-debugger/server

SMTP catch-all server with a REST API for inspecting captured emails during development and testing.

## Features

- **SMTP Server** -- Catches all emails (no authentication required)
- **REST API** -- List, filter, view, and delete caught emails
- **SQLite Storage** -- In-memory by default, optional file persistence
- **OpenAPI/Swagger** -- Interactive API docs at `/swagger`

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--smtp-port <port>` | `2525` | SMTP server port |
| `--api-port <port>` | `3000` | REST API server port |
| `--persist` | `false` | Enable persistent SQLite storage (`mail-debugger.sqlite`) |

```bash
npx mail-debugger --smtp-port 1025 --api-port 8080 --persist
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/emails` | List emails (supports filtering) |
| `GET` | `/api/emails/:id` | Get full email details |
| `DELETE` | `/api/emails/:id` | Delete a single email |
| `DELETE` | `/api/emails` | Delete all emails |
| `GET` | `/api/health` | Health check and server info |
| `GET` | `/swagger` | OpenAPI/Swagger UI |

### Filtering

`GET /api/emails` supports query parameters:

| Parameter | Description |
|-----------|-------------|
| `from` | Filter by sender (partial match) |
| `to` | Filter by recipient (partial match) |
| `subject` | Filter by subject (partial match) |
| `since` | Emails received after this datetime |
| `until` | Emails received before this datetime |

Example: `GET /api/emails?from=alice&subject=welcome`

## Architecture

```
src/
  main.ts              -- Entry point
  config.ts            -- CLI argument parsing
  types.ts             -- TypeScript interfaces
  db/
    schema.ts          -- SQLite table definitions
    connection.ts      -- Database factory (in-memory / persistent)
    email-repository.ts -- CRUD operations
  smtp/
    smtp-server.ts     -- SMTP server
  parser/
    email-parser.ts    -- Raw email -> structured data
  api/
    app.ts             -- Elysia application with Swagger
    routes/
      emails.ts        -- Email endpoints
      health.ts        -- Health check endpoint
```

## Development

```bash
pnpm nx serve server          # Dev server with watch
pnpm nx test server           # Unit tests
pnpm nx e2e server-e2e        # E2E tests
pnpm nx build server          # Production build
pnpm nx lint server           # Lint
pnpm nx typecheck server      # Type check
```
