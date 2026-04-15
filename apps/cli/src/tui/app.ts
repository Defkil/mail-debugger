import { createNodeApp } from '@rezi-ui/node';
import type { ApiClient } from '@mail-debugger/api-client';
import { createInitialState, type TuiState } from './state.js';
import { createStateContainer } from './state-container.js';
import { type AppHandle, createActions } from './actions.js';
import { createScreenDeps } from './deps.js';
import { createListScreen } from './screens/list-screen.js';
import { createDetailScreen } from './screens/detail-screen.js';
import { setupInputHandling } from './input-handler.js';

const POLL_INTERVAL_MS = 3000;

export async function startTui(
  client: ApiClient,
  apiUrl: string,
): Promise<void> {
  const appTitle = `Mail Debugger | ${apiUrl}`;
  const container = createStateContainer();
  const appHandle: AppHandle = { current: null };

  function quit(): void {
    appHandle.current?.stop();
    process.exit(0);
  }

  const actions = createActions({ appHandle, container, client });
  const screenDeps = createScreenDeps({
    appHandle,
    container,
    client,
    actions,
    appTitle,
    quit,
  });

  const app = createNodeApp<TuiState>({
    initialState: createInitialState(),
    routes: [
      createListScreen(screenDeps.list),
      createDetailScreen(screenDeps.detail),
    ],
    initialRoute: 'list',
  });
  appHandle.current = app;

  setupInputHandling({
    app,
    getCurrentState: container.getCurrentState,
    actions,
    deleteDeps: screenDeps.delete,
    quit,
    setCurrentFocusedId: container.setCurrentFocusedId,
  });

  const pollInterval = setInterval(() => {
    if (app.router?.currentRoute().id === 'list') {
      actions.refreshEmails();
    }
  }, POLL_INTERVAL_MS);

  await actions.refreshEmails();

  try {
    await app.run();
  } finally {
    clearInterval(pollInterval);
  }
}
