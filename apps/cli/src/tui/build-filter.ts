import { type EmailFilter, pickEmailFilter } from '@mail-debugger/client';
import type { TuiState } from './state.js';

export function buildFilter(state: TuiState): EmailFilter | undefined {
  return pickEmailFilter({
    from: state.filterFrom,
    to: state.filterTo,
    subject: state.filterSubject,
  });
}
