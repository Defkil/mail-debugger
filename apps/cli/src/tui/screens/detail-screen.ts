import { ui } from '@rezi-ui/core';
import type { RouteDefinition } from '@rezi-ui/core';
import type { ApiClient } from '@mail-debugger/api-client';
import type { TuiState } from '../state.js';
import { BOX_DEFAULTS, DIM } from '../theme.js';

export interface DetailScreenDeps {
  appTitle: string;
  client: ApiClient;
  setCurrentState: (state: TuiState) => void;
  navigateBack: () => void;
  refreshEmails: () => Promise<void>;
  quit: () => void;
}

export function createDetailScreen(
  deps: DetailScreenDeps,
): RouteDefinition<TuiState> {
  return {
    id: 'detail',
    title: 'Email Detail',
    screen: (_params, { state }) => {
      deps.setCurrentState(state as TuiState);
      const email = state.selectedEmail;

      const detailTitle = email
        ? `${deps.appTitle} > Email #${email.id}`
        : `${deps.appTitle} > Loading...`;

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
                    ui.text(new Date(email.receivedAt).toLocaleString()),
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
              email ? email.textBody || email.htmlBody || '(no body)' : '',
              { wrap: true },
            ),
          ],
        ),
        ui.row({ gap: 1 }, [
          ui.button({
            id: 'btn-back',
            label: '[Esc] Back',
            intent: 'secondary',
            onPress: () => deps.navigateBack(),
          }),
          ui.button({
            id: 'btn-delete',
            label: '[d] Delete',
            intent: 'danger',
            disabled: !email,
            onPress: () => {
              if (email) {
                deps.client.deleteEmail(email.id).then(() => {
                  deps.navigateBack();
                  deps.refreshEmails();
                });
              }
            },
          }),
          ui.button({
            id: 'btn-quit-detail',
            label: '[q] Quit',
            intent: 'secondary',
            onPress: () => deps.quit(),
          }),
        ]),
      ]);
    },
  };
}
