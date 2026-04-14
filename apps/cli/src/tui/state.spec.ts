import { createInitialState } from './state';

describe('createInitialState', () => {
  it('should return empty emails list', () => {
    const state = createInitialState();
    expect(state.emails).toEqual([]);
  });

  it('should have no selected email', () => {
    const state = createInitialState();
    expect(state.selectedEmail).toBeNull();
  });

  it('should start with focusedEmailIndex at 0', () => {
    const state = createInitialState();
    expect(state.focusedEmailIndex).toBe(0);
  });

  it('should have filter hidden', () => {
    const state = createInitialState();
    expect(state.filterVisible).toBe(false);
  });

  it('should have empty filter values', () => {
    const state = createInitialState();
    expect(state.filterFrom).toBe('');
    expect(state.filterTo).toBe('');
    expect(state.filterSubject).toBe('');
  });

  it('should start in loading state', () => {
    const state = createInitialState();
    expect(state.isLoading).toBe(true);
  });

  it('should have no error', () => {
    const state = createInitialState();
    expect(state.error).toBeNull();
  });

  it('should set lastRefresh to current time', () => {
    const before = Date.now();
    const state = createInitialState();
    const after = Date.now();
    expect(state.lastRefresh).toBeGreaterThanOrEqual(before);
    expect(state.lastRefresh).toBeLessThanOrEqual(after);
  });

  it('should return a new object each time', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
