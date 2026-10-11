import {
  type ApiClient,
  type EmailSummary,
  getErrorMessage,
} from '@mail-debugger/client';
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
    const { id } = state.selectedEmail;
    void runReportingErrors(deps, 'Delete failed', async () => {
      await deps.client.deleteEmail(id);
      deps.navigateBack();
      void deps.refreshEmails();
    });
    return;
  }

  if (routeId !== 'list') return;

  if (hasShift) {
    if (state.emails.length === 0) return;
    void runReportingErrors(deps, 'Delete all failed', async () => {
      await deps.client.deleteAllEmails();
      await deps.refreshEmails();
    });
    return;
  }

  const email = deps.getFocusedEmail();
  if (!email) return;
  void runReportingErrors(deps, 'Delete failed', async () => {
    await deps.client.deleteEmail(email.id);
    await deps.refreshEmails();
  });
}

/** Runs an action started from a key press and shows its failure in the UI. */
async function runReportingErrors(
  deps: DeleteHandlerDeps,
  failureMessage: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    deps.setError(getErrorMessage(error, failureMessage));
  }
}
