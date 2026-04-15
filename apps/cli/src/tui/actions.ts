import type { App } from '@rezi-ui/core';
import { type ApiClient, getErrorMessage } from '@mail-debugger/api-client';
import type { TuiState } from './state.js';
import type { StateContainer } from './state-container.js';
import { buildFilter } from './build-filter.js';

export interface TuiActions {
  refreshEmails(): Promise<void>;
  loadEmailDetail(id: number): Promise<void>;
}

/**
 * Handle to the App that is assigned once `createNodeApp` has run. Actions
 * capture this by reference so they can trigger updates and router navigation
 * after the app has been constructed.
 */
export interface AppHandle {
  current: App<TuiState> | null;
}

export interface CreateActionsDeps {
  appHandle: AppHandle;
  container: StateContainer;
  client: ApiClient;
}

export function createActions(deps: CreateActionsDeps): TuiActions {
  const { appHandle, container, client } = deps;

  function app(): App<TuiState> {
    if (!appHandle.current) {
      throw new Error('TUI actions invoked before app initialization');
    }
    return appHandle.current;
  }

  async function refreshEmails(): Promise<void> {
    app().update((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const filter = buildFilter(container.getCurrentState());
      const { data: emails } = await client.listEmails(filter);
      app().update((prev) => ({
        ...prev,
        emails,
        focusedEmailIndex: Math.min(
          prev.focusedEmailIndex,
          Math.max(0, emails.length - 1),
        ),
        isLoading: false,
        lastRefresh: Date.now(),
      }));
    } catch (error) {
      app().update((prev) => ({
        ...prev,
        isLoading: false,
        error: getErrorMessage(error, 'Failed to fetch emails'),
      }));
    }
  }

  async function loadEmailDetail(id: number): Promise<void> {
    app().update((prev) => ({ ...prev, selectedEmail: null }));
    try {
      const email = await client.getEmail(id);
      app().update((prev) => ({ ...prev, selectedEmail: email }));
    } catch (error) {
      app().update((prev) => ({
        ...prev,
        error: getErrorMessage(error, 'Failed to load email'),
      }));
      app().router?.back();
    }
  }

  return { refreshEmails, loadEmailDetail };
}
