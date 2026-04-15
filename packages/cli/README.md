# mail-debugger-cli

Interactive terminal client for [Mail Debugger](https://github.com/Defkil/mail-debugger). Browse, filter, and manage caught emails from the command line -- either through the full-screen TUI or via direct commands for scripting.

## Usage

```bash
pnpx mail-debugger-cli
```

### Interactive TUI (default)

```bash
mail-debugger-cli                                # Connect to localhost:3000
mail-debugger-cli --api-url http://host:4000     # Custom server
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

| Option            | Default                 | Description                        |
| ----------------- | ----------------------- | ---------------------------------- |
| `--api-url <url>` | `http://localhost:3000` | Server API URL                     |
| `--json`          | `false`                 | Output as JSON (command mode only) |

### Filter Options (for `list` command)

| Option               | Description                          |
| -------------------- | ------------------------------------ |
| `--from <addr>`      | Filter by sender (partial match)     |
| `--to <addr>`        | Filter by recipient (partial match)  |
| `--subject <text>`   | Filter by subject (partial match)    |
| `--since <datetime>` | Emails received after this datetime  |
| `--until <datetime>` | Emails received before this datetime |

## Prerequisites

A running [mail-debugger](https://www.npmjs.com/package/mail-debugger) or [mail-debugger-api](https://www.npmjs.com/package/mail-debugger-api) server. The CLI connects to its REST API (default `http://localhost:3000`).

## License

MIT
