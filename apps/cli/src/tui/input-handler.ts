import type { App } from '@rezi-ui/core';
import type { TuiState } from './state.js';
import type { DeleteHandlerDeps } from './delete-handler.js';
import { handleDeleteKey } from './delete-handler.js';
import { calculateNextIndex } from './navigation.js';
import { ZR_KEY_D, ZR_MOD_SHIFT } from './key-codes.js';

export interface InputHandlerDeps {
  app: App<TuiState>;
  getCurrentState: () => TuiState;
  actions: {
    refreshEmails: () => Promise<void>;
  };
  deleteDeps: DeleteHandlerDeps;
  quit: () => void;
  setCurrentFocusedId: (id: string | null) => void;
}

export function setupInputHandling(deps: InputHandlerDeps): void {
  const { app, getCurrentState, actions, deleteDeps, quit } = deps;

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
    deps.setCurrentFocusedId(info.id);
  });

  app.onEvent((ev) => {
    if (ev.kind !== 'engine') return;
    const event = ev.event;

    if (event.kind === 'key' && event.action === 'down') {
      if (app.router?.currentRoute().id === 'list') {
        const state = getCurrentState();
        const count = state.emails.length;
        if (count > 0) {
          const next = calculateNextIndex(
            state.focusedEmailIndex,
            count,
            event.key,
          );
          if (next !== state.focusedEmailIndex) {
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
}
