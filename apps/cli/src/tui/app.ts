import { createNodeApp } from '@rezi-ui/node';
import { ui, rgb } from '@rezi-ui/core';
import type { RouteDefinition } from '@rezi-ui/core';
import type { ApiClient } from '../api/client.js';
import type { EmailSummary, Email, EmailFilter } from '../types.js';

export interface TuiState {
  emails: EmailSummary[];
  selectedEmail: Email | null;
  filterVisible: boolean;
  filterFrom: string;
  filterTo: string;
  filterSubject: string;
  isLoading: boolean;
  error: string | null;
  lastRefresh: number;
}

const DIM = rgb(100, 100, 100);
const ACCENT = rgb(80, 160, 255);
const ERROR_COLOR = rgb(255, 80, 80);

function buildFilter(state: TuiState): EmailFilter | undefined {
  const filter: EmailFilter = {};
  if (state.filterFrom) filter.from = state.filterFrom;
  if (state.filterTo) filter.to = state.filterTo;
  if (state.filterSubject) filter.subject = state.filterSubject;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export async function startTui(client: ApiClient): Promise<void> {
  // Track state externally since App doesn't expose .state
  let currentState: TuiState;

  const routes: RouteDefinition<TuiState>[] = [
    {
      id: 'list',
      title: 'Emails',
      screen: (_params, { router, state, update }) => {
        currentState = state as TuiState;

        return ui.column({ p: 1, gap: 0 }, [
          // Header
          ui.row({ gap: 1 }, [
            ui.text('Mail Debugger', {
              style: { fg: ACCENT, bold: true },
            }),
            ui.text('|', { style: { fg: DIM } }),
            ui.text(`${state.emails.length} email(s)`, {
              style: { fg: DIM },
            }),
            ui.text('|', { style: { fg: DIM } }),
            ui.text(
              `Last refresh: ${new Date(state.lastRefresh).toLocaleTimeString()}`,
              { style: { fg: DIM } }
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

          // Filter bar
          ...(state.filterVisible
            ? [
                ui.row({ gap: 1, p: 0 }, [
                  ui.text('Filter:', { style: { bold: true } }),
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
                      update((prev) => ({ ...prev, filterSubject: value })),
                  }),
                ]),
              ]
            : []),

          // Email table
          ui.table<EmailSummary>({
            id: 'emails-table',
            columns: [
              { key: 'id', header: 'ID', width: 5 },
              {
                key: 'from',
                header: 'From',
                width: 25,
                overflow: 'ellipsis',
              },
              {
                key: 'subject',
                header: 'Subject',
                flex: 1,
                overflow: 'ellipsis',
              },
              {
                key: 'receivedAt',
                header: 'Date',
                width: 20,
                render: (value) =>
                  ui.text(new Date(value as string).toLocaleString()),
              },
              {
                key: 'hasAttachments',
                header: 'Att',
                width: 4,
                render: (value) => ui.text(value ? 'Yes' : ''),
              },
            ],
            data: state.emails,
            getRowKey: (email) => String(email.id),
            virtualized: true,
            onRowPress: (email) => {
              router.navigate('detail', { id: String(email.id) });
            },
          }),

          // Footer
          ui.row({ gap: 2 }, [
            ui.text('q', { style: { fg: ACCENT, bold: true } }),
            ui.text('Quit', { style: { fg: DIM } }),
            ui.text('f', { style: { fg: ACCENT, bold: true } }),
            ui.text('Filter', { style: { fg: DIM } }),
            ui.text('r', { style: { fg: ACCENT, bold: true } }),
            ui.text('Refresh', { style: { fg: DIM } }),
            ui.text('Enter', { style: { fg: ACCENT, bold: true } }),
            ui.text('View', { style: { fg: DIM } }),
            ui.text('D', { style: { fg: ACCENT, bold: true } }),
            ui.text('Delete All', { style: { fg: DIM } }),
          ]),
        ]);
      },
    },
    {
      id: 'detail',
      title: 'Email Detail',
      screen: (_params, { state }) => {
        currentState = state as TuiState;
        const email = state.selectedEmail;

        if (!email) {
          return ui.column({ p: 1 }, [
            ui.spinner({ label: 'Loading email...' }),
          ]);
        }

        return ui.column({ p: 1, gap: 0 }, [
          // Header
          ui.row({ gap: 1 }, [
            ui.text('Mail Debugger', {
              style: { fg: ACCENT, bold: true },
            }),
            ui.text('>', { style: { fg: DIM } }),
            ui.text(`Email #${email.id}`, { style: { bold: true } }),
          ]),

          // Email headers
          ui.box({ border: 'single', p: 1 }, [
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
                ui.text(new Date(email.receivedAt).toLocaleString()),
              ]),
              ...(email.messageId
                ? [
                    ui.row({ gap: 1 }, [
                      ui.text('Message-ID:', { style: { bold: true } }),
                      ui.text(email.messageId),
                    ]),
                  ]
                : []),
            ]),
          ]),

          // Body
          ui.box(
            { border: 'single', p: 1, title: 'Body', overflow: 'scroll' },
            [
              ui.text(email.textBody ?? email.htmlBody ?? '(no body)', {
                wrap: true,
              }),
            ]
          ),

          // Attachments
          ...(email.attachments.length > 0
            ? [
                ui.box({ border: 'single', p: 1, title: 'Attachments' }, [
                  ui.column(
                    { gap: 0 },
                    email.attachments.map((att) =>
                      ui.text(
                        `${att.filename ?? '(unnamed)'}  ${att.contentType}  ${att.size} bytes`,
                        { style: { fg: DIM } }
                      )
                    )
                  ),
                ]),
              ]
            : []),

          // Footer
          ui.row({ gap: 2 }, [
            ui.text('Escape', { style: { fg: ACCENT, bold: true } }),
            ui.text('Back', { style: { fg: DIM } }),
            ui.text('d', { style: { fg: ACCENT, bold: true } }),
            ui.text('Delete', { style: { fg: DIM } }),
            ui.text('q', { style: { fg: ACCENT, bold: true } }),
            ui.text('Quit', { style: { fg: DIM } }),
          ]),
        ]);
      },
    },
  ];

  const initialState: TuiState = {
    emails: [],
    selectedEmail: null,
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

  // Fetch emails
  async function refreshEmails(): Promise<void> {
    app.update((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const filter = buildFilter(currentState);
      const emails = await client.listEmails(filter);
      app.update((prev) => ({
        ...prev,
        emails,
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
  }

  // Fetch single email for detail view
  async function loadEmailDetail(id: number): Promise<void> {
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
  }

  // Key bindings
  app.keys({
    q: () => {
      app.stop();
      process.exit(0);
    },
    f: ({ update }) => {
      update((prev) => ({ ...prev, filterVisible: !prev.filterVisible }));
    },
    r: () => {
      refreshEmails();
    },
    Escape: () => {
      if (app.router?.currentRoute().id === 'detail') {
        app.router.back();
      }
    },
    d: () => {
      const route = app.router?.currentRoute();
      if (route?.id === 'detail' && currentState.selectedEmail) {
        const emailId = currentState.selectedEmail.id;
        client.deleteEmail(emailId).then(() => {
          app.router?.back();
          refreshEmails();
        });
      }
    },
    'shift+d': () => {
      if (app.router?.currentRoute().id === 'list') {
        client.deleteAllEmails().then(() => {
          refreshEmails();
        });
      }
    },
  });

  // Navigate to detail: load the email
  app.onEvent((ev) => {
    if (
      ev.kind === 'action' &&
      'route' in ev &&
      (ev as Record<string, unknown>).route === 'detail'
    ) {
      const params = (ev as Record<string, unknown>).params as
        | Record<string, string>
        | undefined;
      if (params?.id) {
        loadEmailDetail(Number(params.id));
      }
    }
  });

  // Poll for new emails every 3 seconds
  const pollInterval = setInterval(() => {
    if (app.router?.currentRoute().id === 'list') {
      refreshEmails();
    }
  }, 3000);

  // Initial load
  await refreshEmails();

  try {
    await app.run();
  } finally {
    clearInterval(pollInterval);
  }
}
