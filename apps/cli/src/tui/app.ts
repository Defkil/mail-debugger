import { createNodeApp } from '@rezi-ui/node';
import { ui, rgb } from '@rezi-ui/core';
import type { RouteDefinition, TableColumn } from '@rezi-ui/core';
import type { ApiClient } from '../api/client.js';
import type { EmailSummary, Email, EmailFilter } from '../types.js';

// ── State ───────────────────────────────────────────────────────────────────

export interface TuiState {
  emails: EmailSummary[];
  selectedEmail: Email | null;
  focusedEmailIndex: number;
  filterVisible: boolean;
  filterFrom: string;
  filterTo: string;
  filterSubject: string;
  isLoading: boolean;
  error: string | null;
  lastRefresh: number;
}

// ── Global styling ──────────────────────────────────────────────────────────

const NEON = rgb(57, 255, 20);
const DIM = rgb(100, 100, 100);
const ERROR_COLOR = rgb(255, 80, 80);

const BOX_DEFAULTS = {
  border: 'single' as const,
  borderStyle: { fg: NEON },
  width: 'full' as const,
  p: 1,
};

// ── ZREV key constants ─────────────────────────────────────────────────────

const ZR_KEY_UP = 20;
const ZR_KEY_DOWN = 21;
const ZR_KEY_HOME = 12;
const ZR_KEY_END = 13;
const ZR_KEY_PAGE_UP = 14;
const ZR_KEY_PAGE_DOWN = 15;
const ZR_KEY_D = 68; // 'D' uppercase key code
const ZR_MOD_SHIFT = 1;
const PAGE_SIZE = 10;

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFilter(state: TuiState): EmailFilter | undefined {
  const filter: EmailFilter = {};
  if (state.filterFrom) filter.from = state.filterFrom;
  if (state.filterTo) filter.to = state.filterTo;
  if (state.filterSubject) filter.subject = state.filterSubject;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// ── TUI entry ───────────────────────────────────────────────────────────────

export async function startTui(
  client: ApiClient,
  apiUrl: string,
): Promise<void> {
  let currentState: TuiState;
  let currentFocusedId: string | null = null;

  let refreshEmails: () => Promise<void>;
  let loadEmailDetail: (id: number) => Promise<void>;

  function getFocusedEmail(): EmailSummary | undefined {
    return currentState.emails[currentState.focusedEmailIndex];
  }

  function isInputFocused(): boolean {
    return (
      currentFocusedId === 'filter-from' ||
      currentFocusedId === 'filter-to' ||
      currentFocusedId === 'filter-subject'
    );
  }

  function quit(): void {
    app.stop();
    process.exit(0);
  }

  const appTitle = `Mail Debugger | ${apiUrl}`;

  const emailColumns: TableColumn<EmailSummary>[] = [
    { key: 'id', header: 'ID', width: 5 },
    { key: 'from', header: 'From', width: 25, overflow: 'ellipsis' },
    { key: 'subject', header: 'Subject', flex: 1, overflow: 'ellipsis' },
    {
      key: 'date',
      header: 'Date',
      width: 20,
      render: (_value, row) =>
        ui.text(new Date(row.receivedAt).toLocaleString()),
    },
    {
      key: 'att',
      header: 'Att',
      width: 4,
      render: (_value, row) => ui.text(row.hasAttachments ? 'Yes' : ''),
    },
  ];

  // ── Routes ──────────────────────────────────────────────────────────────

  const routes: RouteDefinition<TuiState>[] = [
    {
      id: 'list',
      title: 'Emails',
      screen: (_params, { state, update }) => {
        currentState = state as TuiState;
        const hasEmails = state.emails.length > 0;

        const headerContent = ui.column({ gap: 0 }, [
          ui.box({ ...BOX_DEFAULTS, title: appTitle }, [
            ui.row({ gap: 1 }, [
              ui.text(`${state.emails.length} email(s)`, {
                style: { fg: DIM },
              }),
              ui.text('|', { style: { fg: DIM } }),
              ui.text(
                `Last refresh: ${new Date(state.lastRefresh).toLocaleTimeString()}`,
                { style: { fg: DIM } },
              ),
              ...(state.isLoading
                ? [
                    ui.text('|', { style: { fg: DIM } }),
                    ui.spinner({ label: '' }),
                  ]
                : []),
              ...(state.error
                ? [
                    ui.text('|', { style: { fg: DIM } }),
                    ui.text(state.error, { style: { fg: ERROR_COLOR } }),
                  ]
                : []),
            ]),
          ]),
          ...(state.filterVisible
            ? [
                ui.box({ ...BOX_DEFAULTS, title: 'Filter' }, [
                  ui.row({ gap: 1 }, [
                    ui.text('From:'),
                    ui.input({
                      id: 'filter-from',
                      value: state.filterFrom,
                      placeholder: 'sender...',
                      onInput: (value) =>
                        update((prev) => ({ ...prev, filterFrom: value })),
                    }),
                    ui.text('To:'),
                    ui.input({
                      id: 'filter-to',
                      value: state.filterTo,
                      placeholder: 'recipient...',
                      onInput: (value) =>
                        update((prev) => ({ ...prev, filterTo: value })),
                    }),
                    ui.text('Subject:'),
                    ui.input({
                      id: 'filter-subject',
                      value: state.filterSubject,
                      placeholder: 'subject...',
                      onInput: (value) =>
                        update((prev) => ({
                          ...prev,
                          filterSubject: value,
                        })),
                    }),
                  ]),
                ]),
              ]
            : []),
        ]);

        return ui.focusTrap(
          { id: 'list-focus-trap', active: true, initialFocus: 'emails-table' },
          [
            ui.page({
              header: headerContent,
              body: ui.box({ ...BOX_DEFAULTS, title: 'Emails' }, [
                ui.table<EmailSummary>({
                  id: 'emails-table',
                  columns: emailColumns,
                  data: state.emails,
                  getRowKey: (email) => String(email.id),
                  onRowPress: (email) => {
                    loadEmailDetail(email.id);
                    app.router?.navigate('detail', { id: String(email.id) });
                  },
                  virtualized: true,
                  showHeader: true,
                  border: 'none',
                  focusConfig: {
                    indicator: 'background',
                    style: { fg: NEON },
                    contentStyle: { bold: true },
                  },
                  flex: 1,
                }),
              ]),
              footer: ui.row({ gap: 1 }, [
                ui.button({
                  id: 'btn-enter',
                  label: 'Enter Open',
                  intent: 'secondary',
                  disabled: !hasEmails,
                  focusable: false,
                  onPress: () => {
                    const email = getFocusedEmail();
                    if (email) {
                      loadEmailDetail(email.id);
                      app.router?.navigate('detail', {
                        id: String(email.id),
                      });
                    }
                  },
                }),
                ui.button({
                  id: 'btn-filter',
                  label: '[f] Filter',
                  intent: 'secondary',
                  focusable: false,
                  onPress: () =>
                    update((prev) => ({
                      ...prev,
                      filterVisible: !prev.filterVisible,
                    })),
                }),
                ui.button({
                  id: 'btn-refresh',
                  label: '[r] Refresh',
                  intent: 'secondary',
                  focusable: false,
                  onPress: () => refreshEmails(),
                }),
                ui.button({
                  id: 'btn-delete-focused',
                  label: '[d] Delete',
                  intent: 'danger',
                  disabled: !hasEmails,
                  focusable: false,
                  onPress: () => {
                    const email = getFocusedEmail();
                    if (email) {
                      client.deleteEmail(email.id).then(() => refreshEmails());
                    }
                  },
                }),
                ui.button({
                  id: 'btn-delete-all',
                  label: '[D] Delete All',
                  intent: 'danger',
                  disabled: !hasEmails,
                  focusable: false,
                  onPress: () =>
                    client.deleteAllEmails().then(() => refreshEmails()),
                }),
                ui.button({
                  id: 'btn-quit',
                  label: '[q] Quit',
                  intent: 'secondary',
                  focusable: false,
                  onPress: () => quit(),
                }),
              ]),
              height: 'full',
              p: 1,
              gap: 0,
            }),
          ],
        );
      },
    },
    {
      id: 'detail',
      title: 'Email Detail',
      screen: (_params, { state }) => {
        currentState = state as TuiState;
        const email = state.selectedEmail;

        const detailTitle = email
          ? `${appTitle} > Email #${email.id}`
          : `${appTitle} > Loading...`;

        return ui.column({ p: 1, gap: 0, height: 'full' }, [
          ui.box({ ...BOX_DEFAULTS, title: detailTitle }, [
            ...(email
              ? [
                  ui.row({ gap: 1 }, [
                    ui.text(`From: ${email.from}`, {
                      style: { fg: DIM },
                    }),
                    ui.text('|', { style: { fg: DIM } }),
                    ui.text(`Subject: ${email.subject}`, {
                      style: { fg: DIM },
                    }),
                  ]),
                ]
              : [ui.spinner({ label: 'Loading email...' })]),
          ]),
          ...(email
            ? [
                ui.box({ ...BOX_DEFAULTS, title: 'Headers' }, [
                  ui.column({ gap: 0 }, [
                    ui.row({ gap: 1 }, [
                      ui.text('From:', { style: { bold: true } }),
                      ui.text(email.from),
                    ]),
                    ui.row({ gap: 1 }, [
                      ui.text('To:', { style: { bold: true } }),
                      ui.text(email.to.join(', ')),
                    ]),
                    ...(email.cc.length > 0
                      ? [
                          ui.row({ gap: 1 }, [
                            ui.text('CC:', { style: { bold: true } }),
                            ui.text(email.cc.join(', ')),
                          ]),
                        ]
                      : []),
                    ...(email.bcc.length > 0
                      ? [
                          ui.row({ gap: 1 }, [
                            ui.text('BCC:', { style: { bold: true } }),
                            ui.text(email.bcc.join(', ')),
                          ]),
                        ]
                      : []),
                    ui.row({ gap: 1 }, [
                      ui.text('Subject:', { style: { bold: true } }),
                      ui.text(email.subject),
                    ]),
                    ui.row({ gap: 1 }, [
                      ui.text('Date:', { style: { bold: true } }),
                      ui.text(
                        new Date(email.receivedAt).toLocaleString(),
                      ),
                    ]),
                    ...(email.messageId
                      ? [
                          ui.row({ gap: 1 }, [
                            ui.text('Message-ID:', {
                              style: { bold: true },
                            }),
                            ui.text(email.messageId),
                          ]),
                        ]
                      : []),
                  ]),
                ]),
                ...(email.attachments.length > 0
                  ? [
                      ui.box({ ...BOX_DEFAULTS, title: 'Attachments' }, [
                        ui.column(
                          { gap: 0 },
                          email.attachments.map((att) =>
                            ui.text(
                              `${att.filename ?? '(unnamed)'}  ${att.contentType}  ${att.size} bytes`,
                              { style: { fg: DIM } },
                            ),
                          ),
                        ),
                      ]),
                    ]
                  : []),
              ]
            : []),
          ui.box(
            {
              ...BOX_DEFAULTS,
              title: 'Body',
              flex: 1,
              overflow: 'scroll',
            },
            [
              ui.text(
                email
                  ? (email.textBody || email.htmlBody || '(no body)')
                  : '',
                { wrap: true },
              ),
            ],
          ),
          ui.row({ gap: 1 }, [
            ui.button({
              id: 'btn-back',
              label: '[Esc] Back',
              intent: 'secondary',
              onPress: () => app.router?.back(),
            }),
            ui.button({
              id: 'btn-delete',
              label: '[d] Delete',
              intent: 'danger',
              disabled: !email,
              onPress: () => {
                if (email) {
                  client.deleteEmail(email.id).then(() => {
                    app.router?.back();
                    refreshEmails();
                  });
                }
              },
            }),
            ui.button({
              id: 'btn-quit-detail',
              label: '[q] Quit',
              intent: 'secondary',
              onPress: () => quit(),
            }),
          ]),
        ]);
      },
    },
  ];

  // ── App setup ─────────────────────────────────────────────────────────────

  const initialState: TuiState = {
    emails: [],
    selectedEmail: null,
    focusedEmailIndex: 0,
    filterVisible: false,
    filterFrom: '',
    filterTo: '',
    filterSubject: '',
    isLoading: true,
    error: null,
    lastRefresh: Date.now(),
  };

  currentState = initialState;

  const app = createNodeApp<TuiState>({
    initialState,
    routes,
    initialRoute: 'list',
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  refreshEmails = async function (): Promise<void> {
    app.update((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const filter = buildFilter(currentState);
      const emails = await client.listEmails(filter);
      app.update((prev) => ({
        ...prev,
        emails,
        focusedEmailIndex: Math.min(
          prev.focusedEmailIndex,
          Math.max(0, emails.length - 1),
        ),
        isLoading: false,
        lastRefresh: Date.now(),
      }));
    } catch (err) {
      app.update((prev) => ({
        ...prev,
        isLoading: false,
        error:
          err instanceof Error ? err.message : 'Failed to fetch emails',
      }));
    }
  };

  loadEmailDetail = async function (id: number): Promise<void> {
    app.update((prev) => ({ ...prev, selectedEmail: null }));
    try {
      const email = await client.getEmail(id);
      app.update((prev) => ({ ...prev, selectedEmail: email }));
    } catch (err) {
      app.update((prev) => ({
        ...prev,
        error:
          err instanceof Error ? err.message : 'Failed to load email',
      }));
      app.router?.back();
    }
  };

  // ── Key bindings ──────────────────────────────────────────────────────────

  app.keys({
    q: () => quit(),
    f: ({ update }) => {
      if (app.router?.currentRoute().id === 'list') {
        update((prev) => ({ ...prev, filterVisible: !prev.filterVisible }));
      }
    },
    r: () => {
      if (app.router?.currentRoute().id === 'list') {
        refreshEmails();
      }
    },
    Escape: () => {
      if (app.router?.currentRoute().id === 'detail') {
        app.router.back();
      }
    },
  });

  // ── Focus tracking ────────────────────────────────────────────────────────

  app.onFocusChange((info) => {
    currentFocusedId = info.id;
  });

  // ── Event-based key handling ──────────────────────────────────────────────
  // Handle d/D via onEvent to work reliably across all terminal types.
  // onEvent fires before keybinding routing, so we cover both key and text
  // events that terminals may emit for the same physical keypress.

  function handleDeleteKey(hasShift: boolean): void {
    if (isInputFocused()) return;

    const route = app.router?.currentRoute();
    if (route?.id === 'detail' && currentState.selectedEmail) {
      const emailId = currentState.selectedEmail.id;
      client
        .deleteEmail(emailId)
        .then(() => {
          app.router?.back();
          refreshEmails();
        })
        .catch((err) => {
          app.update((prev) => ({
            ...prev,
            error:
              err instanceof Error ? err.message : 'Delete failed',
          }));
        });
    } else if (route?.id === 'list') {
      if (hasShift && currentState.emails.length > 0) {
        client
          .deleteAllEmails()
          .then(() => refreshEmails())
          .catch((err) => {
            app.update((prev) => ({
              ...prev,
              error:
                err instanceof Error ? err.message : 'Delete all failed',
            }));
          });
      } else if (!hasShift) {
        const email = getFocusedEmail();
        if (email) {
          client
            .deleteEmail(email.id)
            .then(() => refreshEmails())
            .catch((err) => {
              app.update((prev) => ({
                ...prev,
                error:
                  err instanceof Error ? err.message : 'Delete failed',
              }));
            });
        }
      }
    }
  }

  app.onEvent((ev) => {
    if (ev.kind !== 'engine') return;
    const event = ev.event;

    // Handle key events (modern terminals / kitty protocol)
    if (event.kind === 'key' && event.action === 'down') {
      if (app.router?.currentRoute().id === 'list') {
        const count = currentState.emails.length;
        if (count > 0) {
          const cur = currentState.focusedEmailIndex;
          let next = cur;

          if (event.key === ZR_KEY_UP) next = Math.max(0, cur - 1);
          else if (event.key === ZR_KEY_DOWN)
            next = Math.min(count - 1, cur + 1);
          else if (event.key === ZR_KEY_HOME) next = 0;
          else if (event.key === ZR_KEY_END) next = count - 1;
          else if (event.key === ZR_KEY_PAGE_UP)
            next = Math.max(0, cur - PAGE_SIZE);
          else if (event.key === ZR_KEY_PAGE_DOWN)
            next = Math.min(count - 1, cur + PAGE_SIZE);

          if (next !== cur) {
            app.update((prev) => ({ ...prev, focusedEmailIndex: next }));
          }
        }
      }

      // 'd' key via key event
      if (event.key === ZR_KEY_D) {
        const hasShift = (event.mods & ZR_MOD_SHIFT) !== 0;
        handleDeleteKey(hasShift);
      }
    }

    // Handle text events (legacy terminals send printable chars as text)
    if (event.kind === 'text') {
      const cp = event.codepoint;
      // lowercase 'd' = 100 → delete single
      if (cp === 100) {
        handleDeleteKey(false);
      }
      // uppercase 'D' = 68 → delete all
      if (cp === 68) {
        handleDeleteKey(true);
      }
    }
  });

  // ── Polling & run ─────────────────────────────────────────────────────────

  const pollInterval = setInterval(() => {
    if (app.router?.currentRoute().id === 'list') {
      refreshEmails();
    }
  }, 3000);

  await refreshEmails();

  try {
    await app.run();
  } finally {
    clearInterval(pollInterval);
  }
}
