# Refactoring Plan

Ziel: Codebase vor neuen Features aufräumen. Fokus auf **Duplizierung zwischen Apps** und **große TUI-Dateien**. Kein Scope-Creep, keine spekulativen Abstraktionen.

Reihenfolge ist nach Abhängigkeiten und Risiko sortiert. Phasen 1–4 sind reine Umzüge, Phase 5 ist inhaltliches Refactoring.

---

## Phase 1 — `libs/types` (shared TypeScript types)

**Problem:** `AttachmentMeta`, `Email`, `EmailSummary`, `EmailFilter`, `HealthResponse`, `PaginatedResponse` sind in `apps/cli/src/types.ts`, `apps/server/src/types.ts` und `apps/web/src/lib/types.ts` fast identisch dupliziert. API-Shape-Änderungen müssen 3× gepflegt werden.

**Scope:**

- [ ] `libs/types` via `nx g @nx/js:lib` generieren (Paketname `@mail-debugger/types`)
- [ ] `pnpm-workspace.yaml` um `libs/*` erweitern
- [ ] Gemeinsame Interfaces nach `libs/types/src/index.ts` verschieben:
  - `AttachmentMeta`, `ParsedEmail`, `Email`, `EmailSummary`, `EmailFilter`, `HealthResponse`, `PaginatedResponse<T>`
- [ ] **Nicht** verschoben werden: `EmailAddress`, `TlsMode`, `Config` (server-only) — bleiben in `apps/server/src/types.ts`
- [ ] `apps/cli/src/types.ts` löschen, Imports auf `@mail-debugger/types` umstellen
- [ ] `apps/web/src/lib/types.ts` löschen, Imports auf `@mail-debugger/types` umstellen
- [ ] `apps/server/src/types.ts` auf nur server-only reduzieren, Rest aus `@mail-debugger/types` re-exporten oder direkt importieren
- [ ] `pnpm nx run-many -t typecheck test` muss grün sein

**Nicht-Ziele:** Keine Schema-Validierung, keine Runtime-Types (Zod etc.). Nur TypeScript-Interfaces.

---

## Phase 2 — `libs/api-client` (shared HTTP client)

**Problem:** `apps/cli/src/api/client.ts:9-20` und `apps/web/src/lib/api.ts:9-20` enthalten die identische `request<T>()` Funktion. Beide Apps haben leicht unterschiedliche Client-APIs (CLI: Factory, Web: Module-Exports; CLI: `health()`, Web: `getHealth()`; CLI ohne Pagination, Web mit).

**Scope:**

- [ ] `libs/api-client` via `nx g @nx/js:lib` generieren (`@mail-debugger/api-client`)
- [ ] Factory-Pattern übernehmen: `createApiClient(baseUrl: string)` mit Methoden `listEmails`, `getEmail`, `deleteEmail`, `deleteAllEmails`, `health`
- [ ] `listEmails` gibt `PaginatedResponse<EmailSummary>` zurück (nicht nur Array), damit CLI dieselbe API nutzt — CLI muss dann `.data` unwrappen
- [ ] Types werden aus `@mail-debugger/types` importiert (Phase 1 Dependency)
- [ ] CLI: `apps/cli/src/api/client.ts` löschen, Aufrufer auf neue Lib umstellen
- [ ] Web: `apps/web/src/lib/api.ts` durch Singleton-Wrapper ersetzen: `export const api = createApiClient('')`
- [ ] Web: Aufrufer ggf. auf `api.listEmails(...)` statt `listEmails(...)` umschreiben
- [ ] Naming vereinheitlichen auf `health` (nicht `getHealth`)
- [ ] `pnpm nx run-many -t typecheck test` grün

**Nicht-Ziele:** Keine eigene Error-Klasse, kein Retry, kein Cache.

---

## Phase 3 — `getErrorMessage()` Util

**Problem:** `error instanceof Error ? error.message : 'fallback'` steht mindestens in:

- `apps/cli/src/tui/delete-handler.ts:26-36`
- `apps/cli/src/tui/app.ts:106-113`
- weitere Stellen im SMTP/API-Code

**Scope:**

- [ ] `getErrorMessage(err: unknown, fallback: string): string` in `libs/types/src/error.ts` anlegen und via Barrel exportieren (Utility, aber passt thematisch — kein eigener Lib-Aufwand nötig)
  - Alternative wenn das zu eng gefasst ist: eigene `libs/shared` Lib. **Entscheidung erst treffen wenn nötig.**
- [ ] Alle ternären Error-Fallbacks auf `getErrorMessage(err, '...')` umstellen
- [ ] `pnpm nx run-many -t typecheck test` grün

---

## Phase 4 — `vitest.config.ts` konsolidieren

**Problem:** Drei Vitest-Configs, zwei identisch, die dritte (Web) schließt willkürlich `src/lib/table.ts` und `src/lib/query.ts` vom Coverage aus.

**Scope:**

- [ ] `vitest.config.base.ts` im Root anlegen mit gemeinsamem Coverage-Setup (include `src/**/*.ts`, exclude `*.spec.ts`, `main.ts`)
- [ ] `apps/cli/vitest.config.ts`, `apps/server/vitest.config.ts`, `apps/web/vitest.config.ts` extenden die Root-Config (via `mergeConfig` oder direkter Import)
- [ ] Web: willkürliche Excludes entfernen (`table.ts`, `query.ts`) — wenn Grund existiert, als Kommentar dokumentieren
- [ ] `pnpm nx run-many -t test` grün

---

## Phase 5 — TUI-Screens splitten

**Problem:** TUI-Dateien vermischen Rendering, State-Management und Side-Effects.

- `apps/cli/src/tui/screens/list-screen.ts` — 193 Zeilen
- `apps/cli/src/tui/screens/detail-screen.ts` — 158 Zeilen
- `apps/cli/src/tui/app.ts` — 165 Zeilen (Setup + State + Polling + Actions)

**Scope (inkrementell):**

- [ ] `app.ts`: Polling-Logik in `hooks/useRefresh.ts` extrahieren
- [ ] `app.ts`: Fetch-Actions in `actions/email-actions.ts` extrahieren
- [ ] `list-screen.ts`: State-Updates und Filter-Logik nach `list-logic.ts`, Rendering bleibt in `list-screen.ts`
- [ ] `detail-screen.ts`: analog splitten wenn sich Muster wiederholt
- [ ] Tests für neue Logic-Module (reine Funktionen = gut testbar)
- [ ] `pnpm nx run-many -t typecheck test lint` grün

**Hinweis:** Das ist das einzige Refactoring mit inhaltlichem Risiko. Nicht am Stück machen, sondern pro Datei einzeln committen.

---

## Phase 6 — Repository JSON-Parsing härten _(optional)_

**Problem:** `apps/server/src/db/email-repository.ts` nutzt `JSON.parse(...) as unknown[]` ohne Fallback.

**Scope:**

- [ ] Kleine Helper `parseJsonArray<T>(raw: string, fallback: T[]): T[]` und `parseJsonObject<T>(raw: string, fallback: T): T`
- [ ] Anwenden auf `to_addr`, `cc_addr`, `bcc_addr`, `headers`, `attachments`
- [ ] Test für korrupte DB-Rows (Parse-Fehler → Fallback statt Crash)

Nur machen falls noch DB-Änderungen geplant sind. Sonst überspringen.

---

## Out of Scope

Explizit **nicht** in dieser Refactoring-Runde:

- `libs/formatting` (text/date/bytes-Utils bündeln) — aktuell nur Web nutzt `timeAgo`/`formatBytes`, CLI nur `truncate`/`padRight`. Keine Duplizierung, keine Abstraktion nötig.
- Magic-String-Konstanten (Filter-IDs etc.) — kosmetisch, geringer Nutzen
- `apps/web/tsconfig.json` auf `tsconfig.base.json` umstellen — Svelte-Kit generiert die Config, Risiko > Nutzen
- SMTP-Server-Struktur — ist bereits modular und sauber
- Web-Komponenten-Tests hinzufügen — eigenständiges Thema, kein Cleanup

---

## Commit-Strategie

Pro Phase mindestens ein Commit, bei Phase 5 pro Datei einer. Commit-Messages im bestehenden Stil (`refactor:`, `build:`, `test:`). Nach jeder Phase `pnpm nx run-many -t typecheck test lint` grün, bevor die nächste beginnt.
