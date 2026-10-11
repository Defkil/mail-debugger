import type { App } from '@rezi-ui/core';
import type { EmailSummary } from '@mail-debugger/client';
import {
  createMockClient,
  mockEmail,
  mockSummary,
} from '../commands/test-fixtures.js';
import { createActions } from './actions.js';
import { createScreenDeps } from './deps.js';
import { setupInputHandling } from './input-handler.js';
import { ZR_KEY_D, ZR_KEY_DOWN, ZR_MOD_SHIFT } from './key-codes.js';
import { createInitialState, type TuiState } from './state.js';
import { createStateContainer } from './state-container.js';

// The interactive inbox without a terminal: a fake Rezi app records the
// handlers the inbox registers and applies its state updates.

type Updater = TuiState | ((previous: TuiState) => TuiState);
type KeyHandler = (context: { update: (updater: Updater) => void }) => void;

function fakeApp(initial: Partial<TuiState> = {}, initialRoute = 'list') {
  let state: TuiState = { ...createInitialState(), ...initial };
  let route = initialRoute;
  const handlers: {
    keys: Record<string, KeyHandler>;
    event?: (event: unknown) => void;
    focus?: (info: { id: string | null }) => void;
  } = { keys: {} };
  const router = {
    currentRoute: () => ({ id: route }),
    back: vi.fn(),
    navigate: vi.fn(),
  };
  const update = (updater: Updater) => {
    state = typeof updater === 'function' ? updater(state) : updater;
  };
  const app = {
    router,
    update,
    keys: (map: Record<string, KeyHandler>) => {
      handlers.keys = map;
    },
    onEvent: (handler: (event: unknown) => void) => {
      handlers.event = handler;
    },
    onFocusChange: (handler: (info: { id: string | null }) => void) => {
      handlers.focus = handler;
    },
  };
  return {
    app: app as unknown as App<TuiState>,
    router,
    handlers,
    update,
    state: () => state,
    setRoute: (id: string) => {
      route = id;
    },
  };
}

const second: EmailSummary = { ...mockSummary, id: 2, subject: 'Second' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- the project's ES2022 types do not include withResolvers
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('TUI actions', () => {
  it('loads the filtered list and keeps the focus inside it', async () => {
    const fake = fakeApp({ focusedEmailIndex: 5 });
    const container = createStateContainer();
    container.setCurrentState({ ...fake.state(), filterSubject: 'Test' });
    const client = createMockClient({
      listEmails: vi.fn().mockResolvedValue({ data: [mockSummary, second] }),
    });
    const actions = createActions({
      appHandle: { current: fake.app },
      container,
      client,
    });

    await actions.refreshEmails();

    expect(client.listEmails).toHaveBeenCalledWith({ subject: 'Test' });
    expect(fake.state()).toMatchObject({
      emails: [mockSummary, second],
      focusedEmailIndex: 1,
      isLoading: false,
      error: null,
    });
  });

  it('shows a failed refresh and a failed detail load', async () => {
    const fake = fakeApp({}, 'detail');
    const client = createMockClient({
      listEmails: vi.fn().mockRejectedValue(new Error('connection refused')),
      getEmail: vi.fn().mockRejectedValue(new Error('gone')),
    });
    const actions = createActions({
      appHandle: { current: fake.app },
      container: createStateContainer(),
      client,
    });

    await actions.refreshEmails();
    expect(fake.state()).toMatchObject({
      isLoading: false,
      error: 'connection refused',
    });

    await actions.loadEmailDetail(1);
    expect(fake.state()).toMatchObject({ selectedEmail: null, error: 'gone' });
    expect(fake.router.back).toHaveBeenCalled();
  });

  it('loads one email for the detail screen', async () => {
    const fake = fakeApp();
    const actions = createActions({
      appHandle: { current: fake.app },
      container: createStateContainer(),
      client: createMockClient(),
    });
    await actions.loadEmailDetail(1);
    expect(fake.state().selectedEmail).toEqual(mockEmail);
  });

  it('keeps the newest refresh when earlier requests complete later', async () => {
    const fake = fakeApp();
    const older = deferred<{
      data: EmailSummary[];
      total: number;
    }>();
    const client = createMockClient({
      listEmails: vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce({ data: [second], total: 1 }),
    });
    const actions = createActions({
      appHandle: { current: fake.app },
      container: createStateContainer(),
      client,
    });
    const pending = actions.refreshEmails();
    await actions.refreshEmails();
    older.resolve({ data: [mockSummary], total: 1 });
    await pending;
    expect(fake.state().emails).toEqual([second]);
    expect(fake.state().isLoading).toBe(false);
  });

  it('ignores a superseded detail failure instead of leaving the newer email', async () => {
    const fake = fakeApp({}, 'detail');
    const older = deferred<typeof mockEmail>();
    const newer = { ...mockEmail, id: 2, subject: 'New selection' };
    const client = createMockClient({
      getEmail: vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce(newer),
    });
    const actions = createActions({
      appHandle: { current: fake.app },
      container: createStateContainer(),
      client,
    });
    const pending = actions.loadEmailDetail(1);
    await actions.loadEmailDetail(2);
    older.reject(new Error('The old email was deleted'));
    await pending;
    expect(fake.state().selectedEmail).toEqual(newer);
    expect(fake.state().error).toBeNull();
    expect(fake.router.back).not.toHaveBeenCalled();
  });

  it('refuses to run before the app exists', async () => {
    const actions = createActions({
      appHandle: { current: null },
      container: createStateContainer(),
      client: createMockClient(),
    });
    await expect(actions.refreshEmails()).rejects.toThrow(
      'before app initialization',
    );
  });
});

describe('TUI state container and screen wiring', () => {
  it('tracks the focused email and whether a filter input has the focus', () => {
    const container = createStateContainer();
    container.setCurrentState({
      ...createInitialState(),
      emails: [mockSummary, second],
      focusedEmailIndex: 1,
    });
    expect(container.getFocusedEmail()).toEqual(second);
    container.setCurrentFocusedId('filter-subject');
    expect(container.isInputFocused()).toBe(true);
    container.setCurrentFocusedId('emails-table');
    expect(container.isInputFocused()).toBe(false);
  });

  it('routes navigation and errors through the app', () => {
    const fake = fakeApp({}, 'detail');
    const container = createStateContainer();
    const actions = createActions({
      appHandle: { current: fake.app },
      container,
      client: createMockClient(),
    });
    const deps = createScreenDeps({
      appHandle: { current: fake.app },
      container,
      client: createMockClient(),
      actions,
      appTitle: 'Mail Debugger',
      quit: vi.fn(),
    });

    deps.list.navigateToDetail('7');
    expect(fake.router.navigate).toHaveBeenCalledWith('detail', { id: '7' });
    deps.detail.navigateBack();
    expect(fake.router.back).toHaveBeenCalled();
    expect(deps.delete.getCurrentRouteId()).toBe('detail');
    deps.delete.setError('Delete failed');
    expect(fake.state().error).toBe('Delete failed');
  });
});

function setupInput(state: Partial<TuiState>, route = 'list') {
  const fake = fakeApp(state, route);
  const client = createMockClient();
  const deps = {
    app: fake.app,
    getCurrentState: fake.state,
    actions: { refreshEmails: vi.fn().mockResolvedValue(undefined) },
    deleteDeps: {
      getCurrentState: fake.state,
      getCurrentRouteId: () => fake.router.currentRoute().id,
      isInputFocused: () => false,
      getFocusedEmail: () =>
        fake.state().emails[fake.state().focusedEmailIndex],
      client,
      navigateBack: vi.fn(),
      refreshEmails: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
    },
    quit: vi.fn(),
    setCurrentFocusedId: vi.fn(),
  };
  setupInputHandling(deps);
  const key = (name: string) =>
    fake.handlers.keys[name]?.({ update: fake.update });
  return { fake, client, deps, key };
}

describe('TUI input', () => {
  it('quits, toggles the filter and refreshes on the list', () => {
    const { fake, deps, key } = setupInput({ emails: [mockSummary] });
    key('f');
    expect(fake.state().filterVisible).toBe(true);
    key('r');
    expect(deps.actions.refreshEmails).toHaveBeenCalled();
    key('q');
    expect(deps.quit).toHaveBeenCalled();
  });

  it('goes back from the detail screen with Escape', () => {
    const { fake, deps, key } = setupInput({}, 'detail');
    key('f');
    key('r');
    expect(fake.state().filterVisible).toBe(false);
    expect(deps.actions.refreshEmails).not.toHaveBeenCalled();
    key('Escape');
    expect(fake.router.back).toHaveBeenCalled();
  });

  it('moves the focus with arrow keys and deletes with d and shift+D', () => {
    const { fake, client, deps } = setupInput({
      emails: [mockSummary, second],
    });
    const send = (event: object) =>
      fake.handlers.event?.({ kind: 'engine', event });

    send({ kind: 'key', action: 'down', key: ZR_KEY_DOWN, mods: 0 });
    expect(fake.state().focusedEmailIndex).toBe(1);
    send({ kind: 'text', codepoint: 100 });
    expect(client.deleteEmail).toHaveBeenCalledWith(2);
    send({ kind: 'key', action: 'down', key: ZR_KEY_D, mods: ZR_MOD_SHIFT });
    expect(client.deleteAllEmails).toHaveBeenCalled();

    fake.handlers.focus?.({ id: 'filter-from' });
    expect(deps.setCurrentFocusedId).toHaveBeenCalledWith('filter-from');
  });

  it('ignores events of other sources', () => {
    const { fake, client } = setupInput({ emails: [mockSummary] });
    fake.handlers.event?.({ kind: 'action' });
    fake.handlers.event?.({
      kind: 'engine',
      event: { kind: 'key', action: 'up', key: ZR_KEY_D, mods: 0 },
    });
    expect(client.deleteEmail).not.toHaveBeenCalled();
    expect(fake.state().focusedEmailIndex).toBe(0);
  });
});
