import type { EmailSummary, Email } from '@mail-debugger/types';

export interface TuiState {
  emails: EmailSummary[];
  selectedEmail: Email | null;
  focusedEmailIndex: number;
  filterVisible: boolean;
  filterFrom: string;
  filterTo: string;
  filterSubject: string;
  isLoading: boolean;
  error: string | null;
  lastRefresh: number;
}

export function createInitialState(): TuiState {
  return {
    emails: [],
    selectedEmail: null,
    focusedEmailIndex: 0,
    filterVisible: false,
    filterFrom: '',
    filterTo: '',
    filterSubject: '',
    isLoading: true,
    error: null,
    lastRefresh: Date.now(),
  };
}
