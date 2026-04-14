# mail-debugger-api

Slim SMTP + REST API build of [Mail Debugger](https://github.com/Defkil/mail-debugger). Same wire protocol as `mail-debugger`, but without the bundled web UI — meant for CI/E2E where install time and footprint matter.

## Usage

```bash
pnpx mail-debugger-api
```

This starts an **SMTP server** on port `2525` and an **API server** on port `3000` with Swagger UI at `http://localhost:3000/swagger`.

```bash
# Custom ports with persistent storage
pnpx mail-debugger-api --smtp-port 1025 --api-port 8080 --persist
```

## CLI Options

| Option               | Default | Description                                               |
| -------------------- | ------- | --------------------------------------------------------- |
| `--smtp-port <port>` | `2525`  | SMTP server port                                          |
| `--api-port <port>`  | `3000`  | REST API server port                                      |
| `--persist`          | `false` | Enable persistent SQLite storage (`mail-debugger.sqlite`) |
| `--tls <mode>`       | `none`  | TLS mode: `none`, `starttls`, or `implicit`               |

## API Reference

| Method   | Endpoint          | Description                      |
| -------- | ----------------- | -------------------------------- |
| `GET`    | `/api/emails`     | List emails (supports filtering) |
| `GET`    | `/api/emails/:id` | Get full email details           |
| `DELETE` | `/api/emails/:id` | Delete a single email            |
| `DELETE` | `/api/emails`     | Delete all emails                |
| `GET`    | `/api/health`     | Health check and server info     |
| `GET`    | `/swagger`        | OpenAPI/Swagger UI               |

Need the web UI or the interactive CLI client? Install the full [`mail-debugger`](https://www.npmjs.com/package/mail-debugger) package instead — `pnpx mail-debugger --cli` drops you into a terminal inbox.

## License

MIT
