# mail-debugger-cli

[![npm](https://img.shields.io/npm/v/mail-debugger-cli)](https://www.npmjs.com/package/mail-debugger-cli)
[![License: MIT](https://img.shields.io/npm/l/mail-debugger-cli)](LICENSE)

The terminal client of [mail-debugger](https://github.com/Defkil/mail-debugger#readme): read, wait for and delete the mail a running mail-debugger caught, with scriptable commands or an interactive inbox. The same client is also the `cli` command of the `mail-debugger` package (`mail-debugger cli ...`).

## Usage

Requires Node.js 22.17 or later and a running [`mail-debugger`](https://www.npmjs.com/package/mail-debugger) or [`mail-debugger-api`](https://www.npmjs.com/package/mail-debugger-api), version 0.4 or later.

```sh
npx --yes mail-debugger-cli list
```

```sh
mail-debugger-cli list                                   # newest emails as a table
mail-debugger-cli list --from alice --subject welcome    # filtered
mail-debugger-cli list --limit 10 --offset 10 --json     # second page, as JSON
mail-debugger-cli show 5                                 # one email
mail-debugger-cli wait --to user@example.test            # wait for the next matching email
mail-debugger-cli delete 5                               # delete one email
mail-debugger-cli delete-all                             # delete all emails
mail-debugger-cli health                                 # server status
mail-debugger-cli                                        # interactive inbox
mail-debugger-cli --api-url http://127.0.0.1:4000 list   # another server
```

### Commands

| Command       | Effect                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| `list`        | Lists emails, newest first                                                              |
| `show <id>`   | Shows one email: headers, body and attachments                                          |
| `wait`        | Waits for the next matching email and prints it; exits with 1 when none arrives in time |
| `delete <id>` | Deletes one email                                                                       |
| `delete-all`  | Deletes all emails                                                                      |
| `health`      | Shows the server status                                                                 |
| (none)        | Starts the interactive inbox, which needs a terminal                                    |

### Options

| Option              | Applies to | Effect                                                                                                  |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `--api-url <url>`   | all        | Server URL (default `http://127.0.0.1:3000`)                                                            |
| `--json`            | commands   | Print JSON instead of text                                                                              |
| `--from <text>`     | list, wait | Sender contains the text (case-insensitive)                                                             |
| `--to <text>`       | list, wait | A recipient contains the text                                                                           |
| `--subject <text>`  | list, wait | Subject contains the text                                                                               |
| `--since <date>`    | list, wait | Received at or after (`YYYY-MM-DD` or ISO 8601)                                                         |
| `--until <date>`    | list, wait | Received at or before                                                                                   |
| `--limit <n>`       | list       | Page size, 1 to 200 (default 50)                                                                        |
| `--offset <n>`      | list       | Emails to skip (default 0)                                                                              |
| `--after-id <id>`   | wait       | Only emails with a higher id (default: the newest id when the command starts, so only new emails count) |
| `--mailbox-id <id>` | wait       | Fail if the server holds another mailbox data set                                                       |
| `--timeout <ms>`    | wait       | How long to wait, up to 3600000 (default 30000)                                                         |
| `-h`, `--help`      |            | Show the help                                                                                           |
| `-v`, `--version`   |            | Show the version                                                                                        |

A server started with `MAIL_DEBUGGER_API_TOKEN` needs the same variable in the environment of the client; the client never takes a token as an argument. Results go to stdout and errors to stderr. Exit status: 0 on success, 1 on errors and wait timeouts, 2 on usage errors.

### Interactive inbox

Without a command, the client opens a full-screen inbox in the terminal: a table of emails that refreshes every 3 seconds and a detail view.

| Key                               | Action                             |
| --------------------------------- | ---------------------------------- |
| Up, Down, Page Up/Down, Home, End | Move through the list              |
| Enter                             | Open the email                     |
| Escape                            | Back to the list                   |
| `f`                               | Show or hide the filter bar        |
| `r`                               | Refresh                            |
| `d`                               | Delete the focused or opened email |
| `D`                               | Delete all emails                  |
| `q`                               | Quit                               |

It uses the native engine of [Rezi](https://github.com/RtlZeroMemory/Rezi), which ships binaries for Linux (glibc), macOS and Windows on x64 and arm64. On other systems, such as musl-based Linux, the commands still work and the inbox explains that it cannot start. Control characters in captured mail are shown as `�`, so a message cannot send escape sequences to your terminal.

## License

[MIT](LICENSE)
