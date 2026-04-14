import type { EmailFilter } from '../types.js';
import type { TuiState } from './state.js';

export function buildFilter(state: TuiState): EmailFilter | undefined {
  const filter: EmailFilter = {};
  if (state.filterFrom) filter.from = state.filterFrom;
  if (state.filterTo) filter.to = state.filterTo;
  if (state.filterSubject) filter.subject = state.filterSubject;
  return Object.keys(filter).length > 0 ? filter : undefined;
}
