import type { ApiClient } from '@mail-debugger/api-client';
import type { AppHandle, TuiActions } from './actions.js';
import type { StateContainer } from './state-container.js';
import type { DeleteHandlerDeps } from './delete-handler.js';
import type { ListScreenDeps } from './screens/list-screen.js';
import type { DetailScreenDeps } from './screens/detail-screen.js';

export interface ScreenDepsBundle {
  list: ListScreenDeps;
  detail: DetailScreenDeps;
  delete: DeleteHandlerDeps;
}

export interface CreateScreenDepsOptions {
  appHandle: AppHandle;
  container: StateContainer;
  client: ApiClient;
  actions: TuiActions;
  appTitle: string;
  quit: () => void;
}

/**
 * Wires the dependency bundles for the list/detail screens and the delete
 * handler. All navigation and state-update callbacks route through the shared
 * `appHandle` so this factory can run before `createNodeApp` has returned.
 */
export function createScreenDeps(
  options: CreateScreenDepsOptions,
): ScreenDepsBundle {
  const { appHandle, container, client, actions, appTitle, quit } = options;

  const router = () => appHandle.current?.router;

  return {
    list: {
      appTitle,
      client,
      setCurrentState: container.setCurrentState,
      getFocusedEmail: container.getFocusedEmail,
      quit,
      loadEmailDetail: actions.loadEmailDetail,
      navigateToDetail: (id) => router()?.navigate('detail', { id }),
      refreshEmails: actions.refreshEmails,
    },
    detail: {
      appTitle,
      client,
      setCurrentState: container.setCurrentState,
      quit,
      navigateBack: () => router()?.back(),
      refreshEmails: actions.refreshEmails,
    },
    delete: {
      getCurrentState: container.getCurrentState,
      getCurrentRouteId: () => router()?.currentRoute().id,
      isInputFocused: container.isInputFocused,
      getFocusedEmail: container.getFocusedEmail,
      client,
      navigateBack: () => router()?.back(),
      refreshEmails: actions.refreshEmails,
      setError: (message) =>
        appHandle.current?.update((prev) => ({ ...prev, error: message })),
    },
  };
}
