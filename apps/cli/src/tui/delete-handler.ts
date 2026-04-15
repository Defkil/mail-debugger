import { type ApiClient, getErrorMessage } from '@mail-debugger/api-client';
import type { EmailSummary } from '@mail-debugger/types';
import type { TuiState } from './state.js';

export interface DeleteHandlerDeps {
  getCurrentState: () => TuiState;
  getCurrentRouteId: () => string | undefined;
  isInputFocused: () => boolean;
  getFocusedEmail: () => EmailSummary | undefined;
  client: ApiClient;
  navigateBack: () => void;
  refreshEmails: () => Promise<void>;
  setError: (message: string) => void;
}

export function handleDeleteKey(
  deps: DeleteHandlerDeps,
  hasShift: boolean,
): void {
  if (deps.isInputFocused()) return;

  const state = deps.getCurrentState();
  const routeId = deps.getCurrentRouteId();

  if (routeId === 'detail' && state.selectedEmail) {
    deps.client
      .deleteEmail(state.selectedEmail.id)
      .then(() => {
        deps.navigateBack();
        deps.refreshEmails();
      })
      .catch((error) => {
        deps.setError(getErrorMessage(error, 'Delete failed'));
      });
    return;
  }

  if (routeId === 'list') {
    if (hasShift && state.emails.length > 0) {
      deps.client
        .deleteAllEmails()
        .then(() => deps.refreshEmails())
        .catch((error) => {
          deps.setError(getErrorMessage(error, 'Delete all failed'));
        });
    } else if (!hasShift) {
      const email = deps.getFocusedEmail();
      if (email) {
        deps.client
          .deleteEmail(email.id)
          .then(() => deps.refreshEmails())
          .catch((error) => {
            deps.setError(getErrorMessage(error, 'Delete failed'));
          });
      }
    }
  }
}
