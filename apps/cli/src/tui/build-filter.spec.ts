import { buildFilter } from './build-filter';
import { createInitialState } from './state';
import type { TuiState } from './state';

function stateWith(overrides: Partial<TuiState>): TuiState {
  return { ...createInitialState(), ...overrides };
}

describe('buildFilter', () => {
  it('should return undefined when all filter fields are empty', () => {
    const state = stateWith({});
    expect(buildFilter(state)).toBeUndefined();
  });

  it('should include "from" when filterFrom is set', () => {
    const state = stateWith({ filterFrom: 'alice@test.com' });
    expect(buildFilter(state)).toEqual({ from: 'alice@test.com' });
  });

  it('should include "to" when filterTo is set', () => {
    const state = stateWith({ filterTo: 'bob@test.com' });
    expect(buildFilter(state)).toEqual({ to: 'bob@test.com' });
  });

  it('should include "subject" when filterSubject is set', () => {
    const state = stateWith({ filterSubject: 'hello' });
    expect(buildFilter(state)).toEqual({ subject: 'hello' });
  });

  it('should combine multiple filter fields', () => {
    const state = stateWith({
      filterFrom: 'alice@test.com',
      filterSubject: 'hello',
    });
    expect(buildFilter(state)).toEqual({
      from: 'alice@test.com',
      subject: 'hello',
    });
  });

  it('should ignore empty strings', () => {
    const state = stateWith({
      filterFrom: '',
      filterTo: 'bob@test.com',
      filterSubject: '',
    });
    expect(buildFilter(state)).toEqual({ to: 'bob@test.com' });
  });
});
