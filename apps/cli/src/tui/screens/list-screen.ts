import { ui } from '@rezi-ui/core';
import type { RouteDefinition } from '@rezi-ui/core';
import type { ApiClient } from '@mail-debugger/api-client';
import type { EmailSummary } from '@mail-debugger/types';
import type { TuiState } from '../state.js';
import { BOX_DEFAULTS, NEON, DIM, ERROR_COLOR } from '../theme.js';
import { emailColumns } from '../email-columns.js';

export interface ListScreenDeps {
  appTitle: string;
  client: ApiClient;
  setCurrentState: (state: TuiState) => void;
  loadEmailDetail: (id: number) => Promise<void>;
  navigateToDetail: (id: string) => void;
  refreshEmails: () => Promise<void>;
  getFocusedEmail: () => EmailSummary | undefined;
  quit: () => void;
}

export function createListScreen(
  deps: ListScreenDeps,
): RouteDefinition<TuiState> {
  return {
    id: 'list',
    title: 'Emails',
    screen: (_params, { state, update }) => {
      deps.setCurrentState(state as TuiState);
      const hasEmails = state.emails.length > 0;

      const headerContent = ui.column({ gap: 0 }, [
        ui.box({ ...BOX_DEFAULTS, title: deps.appTitle }, [
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
                  deps.loadEmailDetail(email.id);
                  deps.navigateToDetail(String(email.id));
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
                  const email = deps.getFocusedEmail();
                  if (email) {
                    deps.loadEmailDetail(email.id);
                    deps.navigateToDetail(String(email.id));
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
                onPress: () => deps.refreshEmails(),
              }),
              ui.button({
                id: 'btn-delete-focused',
                label: '[d] Delete',
                intent: 'danger',
                disabled: !hasEmails,
                focusable: false,
                onPress: () => {
                  const email = deps.getFocusedEmail();
                  if (email) {
                    deps.client
                      .deleteEmail(email.id)
                      .then(() => deps.refreshEmails());
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
                  deps.client
                    .deleteAllEmails()
                    .then(() => deps.refreshEmails()),
              }),
              ui.button({
                id: 'btn-quit',
                label: '[q] Quit',
                intent: 'secondary',
                focusable: false,
                onPress: () => deps.quit(),
              }),
            ]),
            height: 'full',
            p: 1,
            gap: 0,
          }),
        ],
      );
    },
  };
}
