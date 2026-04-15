import type { EmailSummary } from '@mail-debugger/types';
import { createInitialState, type TuiState } from './state.js';

/**
 * Holds the latest TUI state and focus id outside of rezi-ui's reactive loop.
 * Screens mirror their `state` argument into here via `setCurrentState`, so
 * non-render callbacks (input handlers, polling, delete actions) can read the
 * current view without receiving it as a parameter.
 */
export interface StateContainer {
  getCurrentState(): TuiState;
  setCurrentState(state: TuiState): void;
  getFocusedEmail(): EmailSummary | undefined;
  setCurrentFocusedId(id: string | null): void;
  isInputFocused(): boolean;
}

const FILTER_INPUT_IDS = new Set([
  'filter-from',
  'filter-to',
  'filter-subject',
]);

export function createStateContainer(): StateContainer {
  let currentState: TuiState = createInitialState();
  let currentFocusedId: string | null = null;

  return {
    getCurrentState: () => currentState,
    setCurrentState: (state) => {
      currentState = state;
    },
    getFocusedEmail: () => currentState.emails[currentState.focusedEmailIndex],
    setCurrentFocusedId: (id) => {
      currentFocusedId = id;
    },
    isInputFocused: () =>
      currentFocusedId !== null && FILTER_INPUT_IDS.has(currentFocusedId),
  };
}
