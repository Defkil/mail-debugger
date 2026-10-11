# Contributing to mail-debugger

Thanks for your interest. Bug reports, focused fixes and well-argued feature ideas are welcome. Please read the [code of conduct](CODE_OF_CONDUCT.md) first, and report security problems privately as described in [SECURITY.md](SECURITY.md), not in issues.

## Reporting issues

Use the issue forms. A good report names the version (`mail-debugger --version`), the distribution, the Node.js version, the operating system and CPU, the command line and the smallest steps that reproduce the problem. Replace secrets with `***` and use made-up addresses and content: never paste real mail, passwords or tokens.

## Setting up

You need:

- Node.js 24.15 or later for development (the published packages run on Node.js 22.17 or later),
- pnpm 12.11.2, the version in `package.json#packageManager` (`corepack enable` on Node.js 24, or `npm install --global pnpm@12.11.2`),
- Git with LF line endings (`.gitattributes` enforces them).

```sh
git clone https://github.com/Defkil/mail-debugger.git
cd mail-debugger
pnpm install --frozen-lockfile
pnpm run setup    # installs the pre-commit hook (lint-staged: ESLint and Prettier)
```

Install scripts of dependencies are allowed explicitly in `pnpm-workspace.yaml` (`strictDepBuilds`). If a dependency change brings a new one, pnpm stops the install; review the script before you allow or deny it there.

## Workspace

The repository is an [Nx](https://nx.dev) workspace with pnpm. Nx runs without its daemon and without Nx Cloud.

| Project (Nx name)           | Directory         | Contents                                                                                  |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `@mail-debugger/server`     | `apps/server`     | SMTP, HTTP (Elysia), IMAP (ImapKit), MCP and storage (sql.js); the `mail-debugger` binary |
| `@mail-debugger/web`        | `apps/web`        | The web inbox (SvelteKit, static build served by the server)                              |
| `@mail-debugger/cli`        | `apps/cli`        | The terminal client and the interactive inbox (Rezi)                                      |
| `client`                    | `libs/client`     | `mail-debugger/client`: wire types and the REST client                                    |
| `@mail-debugger/server-e2e` | `apps/server-e2e` | End-to-end tests against the built binaries, and the `smoke` target                       |
| `mail-debugger-api`         | `packages/api`    | The slim distribution; its build copies `apps/server/dist-api`                            |
| `mail-debugger-cli`         | `packages/cli`    | The terminal client distribution; its build copies `apps/cli/dist`                        |

The root `package.json` is the `mail-debugger` distribution. [docs/architecture.md](docs/architecture.md) explains how the parts fit together.

## Commands

| Command             | Runs                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`        | Every build: client, web inbox, server bundles, CLI and the two wrapper distributions                                                       |
| `pnpm lint`         | ESLint, including `.svelte` files                                                                                                           |
| `pnpm typecheck`    | TypeScript and `svelte-check`                                                                                                               |
| `pnpm test`         | Unit tests with a coverage summary per project and coverage floors for the core modules                                                     |
| `pnpm test:release` | Isolated release-script tests with mocked npm and registry calls; nothing is published                                                      |
| `pnpm e2e`          | End-to-end tests: real servers on free ports, Nodemailer, ImapFlow and the MCP SDK client                                                   |
| `pnpm smoke`        | Packs the three distributions, installs each tarball into an empty project and runs it (see below)                                          |
| `pnpm format:check` | Prettier                                                                                                                                    |
| `pnpm verify`       | Everything a change has to pass, in order: formatting, `pnpm audit --prod`, lint, typecheck, unit tests, builds, end-to-end and smoke tests |

Single projects run through Nx, for example `pnpm nx test @mail-debugger/server`, `pnpm nx build @mail-debugger/cli` or `pnpm nx run @mail-debugger/server-e2e:e2e`. For development, `pnpm nx serve @mail-debugger/server` rebuilds and restarts the server on changes, and `pnpm nx serve @mail-debugger/web` starts the Vite dev server of the web inbox with a proxy to the API on port 3000.

## Tests

- **Unit tests** (Vitest) sit next to the code as `*.spec.ts`. They cover the mail service, storage and migrations, configuration, REST routes, IMAP and MCP adapters with fault injection, the client, the CLI and the logic of the web inbox. The interactive inbox is rendered with Rezi's test renderer and driven through a fake app, without a terminal.
- **End-to-end tests** (`apps/server-e2e`) start the built binaries on free ports and talk to them like users do: Nodemailer over SMTP in every TLS mode, the REST API and the client, both terminal clients, ImapFlow and raw IMAP transcripts, the MCP SDK client over HTTP and through the stdio bridge. One message is read back through every surface in each TLS mode. Servers are stopped and temporary directories removed after each file.
- **Release-script tests** (`scripts/release-scripts.test.mjs`) use local Git fixtures and mocked npm and registry calls to check release tags, dates, versions and partial-publication recovery. They never publish or contact the registry.
- **The smoke test** (`scripts/pack-and-smoke.mjs`) checks the npm tarballs against an allowlist, installs each into an empty project outside the workspace with production dependencies only, and runs the installed commands, the client import from JavaScript and TypeScript, and SMTP mail read back over REST, IMAP, MCP and the bridge. A change to the published files needs a matching change of its allowlist.
- **No browser or UI automation.** The web inbox is checked through unit tests of its logic, its build and HTTP checks of the served pages and assets; nothing drives a browser. The same goes for the terminal UI.

CI runs `pnpm verify` on Linux with Node.js 24, and the end-to-end and smoke tests on Node.js 22 and 26, and the smoke test alone on Node.js 22.17.0.

### Windows

Everything runs on Windows, including Windows ARM64. Tests stop spawned servers through an IPC message, because Windows has no catchable termination signal for child processes. Nx's daemon is disabled in `nx.json`, since its client hangs on Windows ARM64.

## Changing code

- Keep a change focused on one problem; unrelated clean-ups belong in their own change.
- Code, comments, documentation and commit messages are in English.
- Formatting is Prettier's; the pre-commit hook formats and lints staged files.
- Add or update tests with every behavior change, and update the documentation (`README.md`, `docs/`, the package READMEs) when options, output or protocols change. The option tables in the README files are checked against `--help`; after changing an option, run `UPDATE_README_TABLES=1 pnpm nx test @mail-debugger/server`.
- Note user-visible changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- Dependencies are pinned to exact versions and updated deliberately, in reviewed batches, with `pnpm audit --prod` clean; there are no automated update bots.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(server): ...`, `fix(cli): ...`, `docs: ...`, `test(e2e): ...`, `build: ...`, `ci: ...`. Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

## Pull requests

Fork the repository, create a branch, and open a pull request against `main`. Describe what changes and why, how you checked it (`pnpm verify`, or which parts and why the rest does not apply) and any behavior users will notice. CI must pass before a change is merged.

## Releases

Maintainers release; contributors do not change versions or create tags. The release process and its checks are described in [docs/release.md](docs/release.md).
