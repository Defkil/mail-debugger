# @mail-debugger/cli

Terminal client for the mail-debugger server. Supports both an interactive TUI (powered by [Rezi](https://github.com/RtlZeroMemory/Rezi)) and direct CLI commands for scripting.

## Usage

### Interactive TUI (default)

```bash
mail-debugger-cli                          # Connect to localhost:3000
mail-debugger-cli --api-url http://host:4000  # Custom server
```

Features:
- Email list with table view (ID, From, Subject, Date, Attachments)
- Email detail view with headers, body, and attachments
- Filter bar (toggle with `f`) for From/To/Subject filtering
- Auto-refresh every 3 seconds
- Keyboard shortcuts: `q` quit, `f` filter, `r` refresh, `Enter` view, `Escape` back, `d` delete, `D` delete all

### Direct Commands

```bash
mail-debugger-cli list                                    # List all emails
mail-debugger-cli list --from foo@bar.com --subject test  # Filtered list
mail-debugger-cli show 5                                  # Show email details
mail-debugger-cli delete 5                                # Delete one email
mail-debugger-cli delete-all                              # Delete all emails
mail-debugger-cli health                                  # Server status
```

### Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `--api-url <url>` | `http://localhost:3000` | Server API URL |
| `--json` | `false` | Output as JSON (command mode only) |

### Filter Options (for `list` command)

| Option | Description |
|--------|-------------|
| `--from <addr>` | Filter by sender (partial match) |
| `--to <addr>` | Filter by recipient (partial match) |
| `--subject <text>` | Filter by subject (partial match) |
| `--since <datetime>` | Emails received after this datetime |
| `--until <datetime>` | Emails received before this datetime |

## Architecture

```
src/
  main.ts                   -- Entry point, dispatches TUI or command mode
  types.ts                  -- API types (mirrored from server)
  config/
    parse-config.ts         -- CLI argument parsing
    types.ts                -- Config types and command definitions
  api/
    client.ts               -- HTTP client for all API endpoints
  commands/
    list.ts                 -- List emails command
    show.ts                 -- Show email details command
    delete.ts               -- Delete single email command
    delete-all.ts           -- Delete all emails command
    health.ts               -- Health check command
  formatter/
    format-email-table.ts   -- Table output for email list
    format-email-detail.ts  -- Detailed single email output
    format-health.ts        -- Health check output
    text.ts                 -- Text formatting utilities
  tui/
    app.ts                  -- Rezi TUI application
    state.ts                -- TUI state management
    navigation.ts           -- Screen navigation
    build-filter.ts         -- Filter input builder
    delete-handler.ts       -- Delete confirmation flow
    email-columns.ts        -- Table column definitions
    key-codes.ts            -- Keyboard input handling
    theme.ts                -- Colors and styling
    screens/
      list-screen.ts        -- Email list view
      detail-screen.ts      -- Email detail view
```

## Development

```bash
pnpm nx serve cli       # Dev mode with watch
pnpm nx build cli       # Production build
pnpm nx test cli        # Unit tests
pnpm nx lint cli        # Lint
```
