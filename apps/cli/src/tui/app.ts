import { createNodeApp } from '@rezi-ui/node';
import type { ApiClient } from '../api/client.js';
import type { TuiState } from './state.js';
import { createInitialState } from './state.js';
import { buildFilter } from './build-filter.js';
import type { DeleteHandlerDeps } from './delete-handler.js';
import { createListScreen } from './screens/list-screen.js';
import type { ListScreenDeps } from './screens/list-screen.js';
import { createDetailScreen } from './screens/detail-screen.js';
import type { DetailScreenDeps } from './screens/detail-screen.js';
import { setupInputHandling } from './input-handler.js';

export async function startTui(
  client: ApiClient,
  apiUrl: string,
): Promise<void> {
  let currentState: TuiState = createInitialState();
  let currentFocusedId: string | null = null;

  const appTitle = `Mail Debugger | ${apiUrl}`;

  function setCurrentState(state: TuiState): void {
    currentState = state;
  }

  function getFocusedEmail() {
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

  const actions: {
    refreshEmails: () => Promise<void>;
    loadEmailDetail: (id: number) => Promise<void>;
  } = {
    refreshEmails: () => Promise.resolve(),
    loadEmailDetail: () => Promise.resolve(),
  };

  const listDeps: ListScreenDeps = {
    appTitle,
    client,
    setCurrentState,
    getFocusedEmail,
    quit,
    get loadEmailDetail() {
      return actions.loadEmailDetail;
    },
    get navigateToDetail() {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- deferred access to `app`
      return (id: string) => app.router?.navigate('detail', { id });
    },
    get refreshEmails() {
      return actions.refreshEmails;
    },
  };

  const detailDeps: DetailScreenDeps = {
    appTitle,
    client,
    setCurrentState,
    quit,
    get navigateBack() {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- deferred access to `app`
      return () => app.router?.back();
    },
    get refreshEmails() {
      return actions.refreshEmails;
    },
  };

  const routes = [createListScreen(listDeps), createDetailScreen(detailDeps)];

  const app = createNodeApp<TuiState>({
    initialState: createInitialState(),
    routes,
    initialRoute: 'list',
  });

  actions.refreshEmails = async function (): Promise<void> {
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
    } catch (error) {
      app.update((prev) => ({
        ...prev,
        isLoading: false,
        error:
          error instanceof Error ? error.message : 'Failed to fetch emails',
      }));
    }
  };

  actions.loadEmailDetail = async function (id: number): Promise<void> {
    app.update((prev) => ({ ...prev, selectedEmail: null }));
    try {
      const email = await client.getEmail(id);
      app.update((prev) => ({ ...prev, selectedEmail: email }));
    } catch (error) {
      app.update((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load email',
      }));
      app.router?.back();
    }
  };

  const deleteDeps: DeleteHandlerDeps = {
    getCurrentState: () => currentState,
    getCurrentRouteId: () => app.router?.currentRoute().id,
    isInputFocused,
    getFocusedEmail,
    client,
    navigateBack: () => app.router?.back(),
    refreshEmails: () => actions.refreshEmails(),
    setError: (message) => app.update((prev) => ({ ...prev, error: message })),
  };

  setupInputHandling({
    app,
    getCurrentState: () => currentState,
    actions,
    deleteDeps,
    quit,
    setCurrentFocusedId: (id) => {
      currentFocusedId = id;
    },
  });

  const pollInterval = setInterval(() => {
    if (app.router?.currentRoute().id === 'list') {
      actions.refreshEmails();
    }
  }, 3000);

  await actions.refreshEmails();

  try {
    await app.run();
  } finally {
    clearInterval(pollInterval);
  }
}
