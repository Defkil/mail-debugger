import { createNodeApp } from '@rezi-ui/node';
import type { ApiClient } from '../api/client.js';
import type { TuiState } from './state.js';
import { createInitialState } from './state.js';
import { buildFilter } from './build-filter.js';
import { calculateNextIndex } from './navigation.js';
import { handleDeleteKey } from './delete-handler.js';
import type { DeleteHandlerDeps } from './delete-handler.js';
import { ZR_KEY_D, ZR_MOD_SHIFT } from './key-codes.js';
import { createListScreen } from './screens/list-screen.js';
import type { ListScreenDeps } from './screens/list-screen.js';
import { createDetailScreen } from './screens/detail-screen.js';
import type { DetailScreenDeps } from './screens/detail-screen.js';

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
      return (id: string) =>
        app.router?.navigate('detail', { id });
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
      return () => app.router?.back();
    },
    get refreshEmails() {
      return actions.refreshEmails;
    },
  };

  const routes = [
    createListScreen(listDeps),
    createDetailScreen(detailDeps),
  ];

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
    } catch (err) {
      app.update((prev) => ({
        ...prev,
        isLoading: false,
        error:
          err instanceof Error ? err.message : 'Failed to fetch emails',
      }));
    }
  };

  actions.loadEmailDetail = async function (id: number): Promise<void> {
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

  const deleteDeps: DeleteHandlerDeps = {
    getCurrentState: () => currentState,
    getCurrentRouteId: () => app.router?.currentRoute().id,
    isInputFocused,
    getFocusedEmail,
    client,
    navigateBack: () => app.router?.back(),
    refreshEmails: () => actions.refreshEmails(),
    setError: (message) =>
      app.update((prev) => ({ ...prev, error: message })),
  };

  app.keys({
    q: () => quit(),
    f: ({ update }) => {
      if (app.router?.currentRoute().id === 'list') {
        update((prev) => ({ ...prev, filterVisible: !prev.filterVisible }));
      }
    },
    r: () => {
      if (app.router?.currentRoute().id === 'list') {
        actions.refreshEmails();
      }
    },
    Escape: () => {
      if (app.router?.currentRoute().id === 'detail') {
        app.router.back();
      }
    },
  });

  app.onFocusChange((info) => {
    currentFocusedId = info.id;
  });

  app.onEvent((ev) => {
    if (ev.kind !== 'engine') return;
    const event = ev.event;

    if (event.kind === 'key' && event.action === 'down') {
      if (app.router?.currentRoute().id === 'list') {
        const count = currentState.emails.length;
        if (count > 0) {
          const next = calculateNextIndex(
            currentState.focusedEmailIndex,
            count,
            event.key,
          );
          if (next !== currentState.focusedEmailIndex) {
            app.update((prev) => ({ ...prev, focusedEmailIndex: next }));
          }
        }
      }

      if (event.key === ZR_KEY_D) {
        handleDeleteKey(deleteDeps, (event.mods & ZR_MOD_SHIFT) !== 0);
      }
    }

    if (event.kind === 'text') {
      const cp = event.codepoint;
      if (cp === 100) handleDeleteKey(deleteDeps, false);
      if (cp === 68) handleDeleteKey(deleteDeps, true);
    }
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
